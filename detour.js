var ResourceTree = require('./lib/ResourceTree').ResourceTree
var _ = require('underscore');
var url = require('url');

function detour(mountPath, module){
  mountPath = mountPath || '/'
  if (!module){
    throw "detour must be instantiated with a url path to route from and a module to handle response.";
  }
	this.mountPath = urlJoin('/', mountPath);
  this.rootResource = new ResourceTree('/', {})
  this.rootResource.module = module
  this.serverSupportedMethods = ["GET", "POST", 
                                  "PUT", "DELETE",
                                  "HEAD", "OPTIONS"]  
  // TODO: above list could be generated when the route table is.
}

detour.prototype.isCollectionRoute = function(node){
    return this._implementsMethods(node, ['collectionGET',
                                      'collectionPOST',
                                      'collectionPUT',
                                      'collectionDELETE'])
}

detour.prototype._implementsMethods = function(node, methods){
    return _.any(methods, function(method){
                            return !!node.module[method]
                          });
  }

detour.prototype.getRouteTable = function(){
  var routes = []
  var that = this;
	var standardMethods = [ "GET", "POST", "DELETE", "PUT"]

	var getNodeRoutes = function(parentPath, node){
		var path = urlJoin(parentPath, node.path) 
    if (that.isCollectionRoute(node)){
        routes.push({ url : path, resource : node})
        var id_name = ':' + node.path.replace(/\//, '') + '_id'
        path = urlJoin(path, id_name)
    }
    if (that._implementsMethods(node, standardMethods)){
      routes.push({ url : path, resource : node})
      _.each(node.children, function(node){
        getNodeRoutes(path, node);
      })
    }
  }
  getNodeRoutes(this.mountPath, this.rootResource)
  return routes;
}

detour.prototype.dispatch = function(req, res){
  var method = req.method
  var moduleMethod = method;
  if (!_.include(this.serverSupportedMethods, method)){
    return this.handle501(req, res)
  }
  if (req.url.length > 4096){
    return this.handle415(req, res)
  }
  try {
    var route = this.requestUrlToRoute(req.url)
  } catch (ex) {
    if (ex == "No matching route found."){
      return this.handle404(req, res)
    } else {
      throw ex;
    }
  }
  var resource = route.resource;
  var pathEndsWith = function(fullPath, subPath){
    var retval = !!fullPath.match(new RegExp(subPath + "[\/]?$"));
    return retval;
  }
  var isCollection = !!this.isCollectionRoute(route.resource) && 
                          pathEndsWith(req.url, route.url)
  if (isCollection){
    moduleMethod = "collection" + method;
  }
  if (!resource.module[moduleMethod]){
    switch(method){
      case "OPTIONS":
        return this.handleOPTIONS(req, res)
      case "HEAD":
        var newModuleMethod = "GET";
        if (isCollection){
          newModuleMethod = "collectionGET";
        }
        res.origSend = res.send;
        res.send = function(code, body){
          if (!body){body = '';}
          code = 204;
          res.origSend(code, '')
        }
        return resource.module[newModuleMethod](req, res)
      default :
        return this.handle405(req, res)
    }
  }
  resource.module[moduleMethod](req, res)
}

detour.prototype.handle415 = function(req, res){
  res.send(414)
}

detour.prototype.handle404 = function(req, res){
  res.send(404)
}

detour.prototype.handle405 = function(req, res){
  res.send(405)
}

detour.prototype.handle501 = function(req, res){
  res.send(501)
}

detour.prototype.isCollection = function(url, route){
  var pathEndsWith = function(fullPath, subPath){
    var retval = !!fullPath.match(new RegExp(subPath + "[\/]?$"));
    return retval;
  }
  var retval = !!this.isCollectionRoute(route.resource) && 
                          pathEndsWith(url, route.url)
  return retval;
  
}

detour.prototype.getMethods = function(route){
  var moduleMethods = _.keys(route.resource.module);
  var retval = _.intersection(moduleMethods, this.serverSupportedMethods);
  return retval
}

detour.prototype.getCollectionMethods = function(route){
  var moduleMethods = _.keys(route.resource.module);
  var httpMethods = []
  _.each(moduleMethods, function(method){
    if (!!method.match(/^collection/)){
      httpMethods.push(method.substring('collection'.length))
    }
  });
  var retval = _.intersection(httpMethods, this.serverSupportedMethods);
  return retval
}

detour.prototype.handleOPTIONS = function(req, res){
  // TODO how to handle HEAD here
  var route = this.requestUrlToRoute(req.url);
  if (this.isCollection(req.url, route)){
    var methods = this.getCollectionMethods(route)
  } else {
    var methods = this.getMethods(route)
  }
  methods = _.union(["OPTIONS"], methods);
  res.header('Allow', methods.join(","))
  res.send(204)
}


// TODO make sure trailing slashes don't affect this
detour.prototype.addRoute = function(path, module){
  var allMethods = ["GET", "POST",
                    "DELETE", "PUT",
                    "collectionGET", "collectionPOST",
                    "collectionPUT", "collectionDELETE"]
  if (!this._implementsMethods({module: module}, allMethods)){
    throw 'The handler you tried to add for path /api/x has no valid HTTP methods.'
  };
  var pieces = path.split('/');
  var kidName = pieces.pop()
  var parent_url = urlJoin(pieces)
  try {
   var parentRoute = this.getRoute(parent_url);
  } catch (ex){
    if (ex == 'That route does not exist: ' + parent_url + '.'){
      throw "Cannot add resource to a parent path that does not exist."
    }
  }
  if (!this._implementsMethods(parentRoute, allMethods)){
    throw "Cannot add resource to a parent path that does not exist."
  }
  parentRoute.addChild(kidName, module)
}


detour.prototype.getUrl = function(){
  var args = _.toArray(arguments);
  var node = args[0];
  var vars = _.rest(args);
  var that = this;

  var getAncestry = function(node){
    if (!node.parentNode){
      return [node];  // terminate recursion at root
    }
    return [getAncestry(node.parentNode), node]
  }
  var nodes = _.flatten(getAncestry(node));
  var collectionCount = 0;
  _.each(nodes, function(node){
    if (that.isCollectionRoute(node)){
      collectionCount++;
    }
  })
  var allowedCounts = [vars.length, vars.length + 1]
  if (!_.include(allowedCounts, collectionCount)){
    throw "getUrl requires " + allowedCounts.join(" or ") + " variables."
  }
  var pieces = [];
  for(var i = 0; i < nodes.length; i++){
    var node = nodes[i];
    if (that.isCollectionRoute(node)){
      pieces.push(node.path)
      if (vars.length > 0){
        pieces.push(vars.shift())
      }
    } else {
      pieces.push(node.path)
    }
  }
  var url = urlJoin(this.mountPath, pieces);
  return url;
}

// TODO put the urlRegex in the routes table so we don't keep creating it
// for faster route lookup
detour.prototype._pathMatchesRouteUrl = function(path, url){
    // swap out wildcard path pieces...
    var matcher = url.replace(/:[^/]+/, "[^/]+")
    // escape slashes and mark beginning/end
    matcher = "^" + matcher.replace(/\//g, '\\/') + "$"
    var re = new RegExp(matcher)
    var matches = path.match(re)
    if (path.match(new RegExp(matcher))){
      return true
    }
    return false;
}

detour.prototype._requestPathToRoute = function(path){
  var that = this;
  var urls = _.pluck(this.getRouteTable(), "url")
  var route = _.find(this.getRouteTable(), function(entry){
    return that._pathMatchesRouteUrl(path, entry.url)
  });
  if (!route){
    throw "No matching route found."
  }
  return route;
}

detour.prototype.requestUrlToRoute = function(urlstr){
  // go through all the getRouteTable() urls and find the first match
  var path = urlJoin(url.parse(urlstr).path)
  return this._requestPathToRoute(path);
}

detour.prototype.traversePaths = function(node, paths){
    var getKidByPath = function(node, path){
      var kid = _.find(node.children, function(kid){
        return kid.path == path;
      });
      if (!kid){
        throw "The given node does not have a child matching the given path."
      }
      return kid;
    }

    if (paths.length == 0){
      return node;
    }

    var path = paths[0];
    paths = _.rest(paths);
    if (this.isCollectionRoute(node)){
      // skip one piece if it's a collection.
      if (paths.length == 0){
        return node;
      } else {
        // TODO! when a collection member has sub resources
      }
    }

    try {
      node = getKidByPath(node, path);
    } catch(ex) {
      if (ex == "The given node does not have a child matching the given path."){
        throw "Unknown path"
      } else {
        throw ex;
      }
    }
    return this.traversePaths(node, paths)
  }

detour.prototype.getRoute = function(urlstr){
  var path = url.parse(urlstr).path
  var pieces = path.split('/');
  pieces = _.filter(pieces, function(piece){ 
      return ((piece != '/') && (piece != ''))
  });
  if (urlJoin('/', pieces[0]) == this.mountPath){
    pieces = _.rest(pieces);
  }
  try {
    return this.traversePaths(this.rootResource, pieces);
  } catch (ex ){
      if (ex == "Unknown path"){
        throw "That route does not exist: " + urlstr + "."
      } else {
        throw ex;
      }

  }
}

detour.prototype.getParentUrl = function(node){
  if (!node.parentNode){
    throw "Cannot get parent url of a node with no parent.";
  }
  return this.getUrl(node.parentNode);
}

exports.detour = detour

function urlJoin(){
	// put a fwd-slash between all pieces and remove any redundant slashes
	// additionally remove the trailing slash
  var pieces = _.flatten(_.toArray(arguments))
  var joined = pieces.join('/').replace(/\/+/g, '/')  
	joined = joined.replace(/\/$/, '')
  if (joined == ''){ joined = '/'; }
  return joined;
}

