var express = require('express');
var should = require('should');
var hottap = require('hottap').hottap;
var _ = require('underscore');
/*

CONSTRAINTS:
* make this a new connect-compatible routing middleware to replace express' router
* ? how to do route-specific middleware like authorization?
* could we add a fetch() method to modules that retrieves the "resource data" 
if possible and returns error if not?  that would allow dynamic 404s to be 
handled automatically.  Only necessary for dynamic routes.
* we want /asdf/1234/qwer/2345 to 404 if /asdf/1234 is a 404.

TODOS:
- preliminary examples in the docs
- support sub resources of collections
- logging
- add HEAD and OPTIONS to handler at route()-time

=== middleware ===
- ?? how to do route-specific middleware like authorization?
- add middleware to route()
- add middleware to dispatch()
- d.before(paths_array, [middlewarez])
- d.beforeExcept(paths_array, [middlewarez])
- d.routes({'/this/is/the/path' : handler, '/this/is/the/path' : handler}, [middlewarezz])


VERSION 2:
- dtrace
- implement fetch() we want /asdf/1234/qwer/2345 to 404 if /asdf/1234 is a 404.
- for star routes... is a search tree faster than a flat table with regexes?
- programmatic routes?  sub-routers?
- PATCH?
- redirects in the router
- conditional GET, e-tags, caching, 304
- cache recent urls / route combinations instead of requiring
regex lookup?  -- perfect for memoization
- use 'moved permanently' (301) for case sensitivity problems
in urls.  this is better for SEO
- unicode route support ( see https://github.com/ckknight/escort )
- d.shouldAllowSparseRoutes = true; // default is false. true = throw exceptions

*/

var detour = require('../detour').detour;

describe('detour', function(){

  var expectException = function(f, extype, exmessage, exdetail){
    try {
      f();
    } catch(ex){
      ex.type.should.equal(extype)
      ex.message.should.equal(exmessage)
      ex.detail.should.equal(exdetail)
      return;
    }
    should.fail("Expected exception '" + extype + "' was not thrown.");
  }

  var FakeRes = function(){
    this.body = '';
    this.headers = {};
    this.status = 0;
    this.end =function(data){ this.body = data || ''; }
    this.writeHead = function(code){this.status = code;}
    this.setHeader = function(name, value){this.headers[name] = value;}
    this.expectHeader = function(name, value){
      if (!this.headers[name]){
        should.fail("header " + name + " was not set.")
      }
      if (this.headers[name] != value){
        should.fail("header " + name + 
                    " was supposed to be " + value + 
                    " but was " + this.headers[name] + ".")
      }
    }
    this.expectStatus = function(status){
      this.status.should.equal(status);
    }
    this.expectEnd = function() { 
      var args = _.toArray(arguments);
      var diff = _.difference(this.sendArgs, args)
      if (diff.length != 0){ 
        should.fail("Expected send(" + 
                    args.join(", ") + 
                    ") but got send(" + 
                    this.sendArgs.join(", ") + ")")
      }
    }
  }

	beforeEach(function(){
    this.res = new FakeRes()
		this.app = {} //express.createServer();
    this.simpleModule = {GET : function(req, res){res.send("OK");}}
    this.simpleCollectionModule = {  
                                    GET : function(req, res){res.send("OK");},
                                    collectionGET : function(req, res){res.send("OK");}
                                  }
	})
	afterEach(function(){
    try {
      this.app.close();
    } catch (ex){
      // do nothing. assumed already closed.
    }
	})

  describe('#name', function(){
    it ("throws an exception if the path doesn't exist", function(){
        var d = new detour()
        expectException(function(){
          d.name('/', 'root')
        }, "PathDoesNotExist", "Cannot name a path that doesn't exist", "/")
    })
    it ("throws an exception if name starts with '/'", function(){
        var d = new detour()
        expectException(function(){
          d.name('/', '/root')
        }, "InvalidName", 
            "Cannot name a path with a name that starts with '/'."
            , '')
    })
    it ("allows a path to be set if it exists", function(){
        var d = new detour()
        d.route('/', function(req, res){ res.send("hello world");});
        d.name('/', 'root')
    })
  })

  describe('#as', function(){
    it ('names the given route', function(){
        var d = new detour()
        d.route('/', function(req, res){ res.send("hello world");}).as("root");
        var url = d.getUrl("root")
        url.should.equal('/')
    })
  });

  describe('#pathVariables', function(){
    it ('returns an empty hash for a static route', function(){
      // d.pathVariables('/this/is/the/path/1234/sub/') // returns {varname : 1234}
      var d = new detour()
      d.route('/', function(req, res){ res.send("hello world");});
      _.keys(d.pathVariables('http://asdf.com/')).length.should.equal(0)
    })
    it ("throws an exception when the url doesn't route", function(){
      var d = new detour()
      expectException(function(){
        d.pathVariables('http://asdf.com/')
      }, "NotFound", 'That route is unknown.', '/')
    })
    it ('returns a hash of vars for a star route', function(){
      var d = new detour()
      d.route('/', function(req, res){ res.send("hello world");});
      d.route('/*onetwothreefour', function(req, res){ res.send("hello world");});
      d.route('/*onetwothreefour/asdf', function(req, res){ res.send("hello world");});
      d.route('/*onetwothreefour/asdf/*fourfivesixseven', function(req, res){ res.send("hello world");});
      var vars = d.pathVariables('http://asdf.com/1234/asdf/4567')
      _.keys(vars).length.should.equal(2)
      vars['onetwothreefour'].should.equal('1234')
      vars['fourfivesixseven'].should.equal('4567')
    })
  });

  describe('#shouldThrowExceptions', function(){
    describe('when set to true', function(){
      it ('throws an exception when the uri is too long', function(){
        var d = new detour()
        d.shouldThrowExceptions = true;
        var simpleModule = this.simpleModule;
        var bigurl = "1"
        _.times(4097, function(){bigurl += '1';})
        d.route('/', simpleModule)
        var req = { url : bigurl, method : "PUT"}
        try {
          d.dispatch(req, this.res)
          should.fail('expected exception was not raised')
        } catch(ex){
          ex.type.should.equal('414')
          ex.message.should.equal('Request-URI Too Long')
        }
      })
      it ('throws an exception when the URI is not found', function(){
        var d = new detour()
        d.shouldThrowExceptions = true;
        var req = {url : "http://asdf.com/", method : 'GET'}
        try {
          d.dispatch(req, this.res)
          should.fail('expected exception was not raised')
        } catch(ex){
          ex.type.should.equal('404')
          ex.message.should.equal('Not Found')
        }
      });
      it ("throws an exception on 405s", function(){
        var d = new detour()
        d.shouldThrowExceptions = true;
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/hello', { GET : function(req, res){res.send("hello world");}});
        var req = { url : "http://asdf.com/hello", method : "PUT"}
        try {
          d.dispatch(req, this.res)
          should.fail('expected exception was not raised')
        } catch(ex){
          ex.type.should.equal('405')
          ex.message.should.equal('Method Not Allowed')
        }
      })
      it ("throws an exception on 500", function(){
        var d = new detour()
        d.shouldThrowExceptions = true;
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/fail', { GET : function(req, res){ throw 'wthizzle';}});
        var req = { url : "http://asdf.com/fail", method : "GET"}
        try {
          d.dispatch(req, this.res)
          should.fail('expected exception was not raised')
        } catch(ex){
          ex.type.should.equal('500')
          ex.message.should.equal('Internal Server Error')
          ex.detail.should.equal('wthizzle');
        }
      })

      it ("throws an exception on 501s", function(){
        var d = new detour()
        d.shouldThrowExceptions = true;
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/hello', { GET : function(req, res){res.send("hello world");}});
        var req = { url : "http://asdf.com/hello", method : "TRACE"}
        try {
          d.dispatch(req, this.res)
          should.fail('expected exception was not raised')
        } catch(ex){
          ex.type.should.equal('501')
          ex.message.should.equal('Not Implemented')
        }
      })
    });
  });

	describe('#getHandler', function(){
    it ("when accessing an undefined url, throws an exception",
      function(){
        var d = new detour()
        expectException(function(){
          d.getHandler('/')
        }, "404", "Not Found", "/")
      }
    )
    it ("when accessing a too-long url, throws an exception", function(){
      var d = new detour()
      var simpleModule = this.simpleModule;
      var bigurl = "1"
      _.times(4097, function(){bigurl += '1';})
      expectException(function(){
        d.getHandler(bigurl)
      }, "414", "Request-URI Too Long", '')
    })
    it ("when accessing a defined url, returns a handler",
      function(){
        var d = new detour()
        d.route('/', function(req, res){ res.send("hello world");});
        var handler = d.getHandler('/')
        should.exist(handler.GET);
      }
    )
  });

	describe('#route', function(){
    it ("can route a function as a GET", function(){
        var d = new detour()
        d.route('/', function(req, res){return "hello world";});
        var req = { url : "http://asdf.com/", method : "GET"}
        d.dispatch(req, this.res)
        this.res.expectEnd("hello world")

    })

    it ("can route an object with a GET", function(){
        var d = new detour()
        d.route('/', { GET : function(req, res){return "hello world";}});
        var req = { url : "http://asdf.com/", method : "GET"}
        d.dispatch(req, this.res)
        this.res.expectEnd("hello world")
    })

    it ("throws an exception if you try to mount a url without a parent", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        expectException(
           function(){
             d.route('/asdf', simpleModule)
           },
           "ParentDoesNotExist", 
           "The route you're trying to add does not have a parent route defined.", 
           '/asdf'
        )
    })

    it ("can add a route if the parent of the path exists", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/hello', { GET : function(req, res){res.end("hello world");}});
        var req = { url : "http://asdf.com/hello", method : "GET"}
        d.dispatch(req, this.res)
        this.res.expectEnd("hello world")
    });

    it ("can add a route to a non-root path that exists", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/hello/', { GET : function(req, res){res.send("hello world");}});
        d.route('/hello/somenum', { GET : function(req, res){res.end("hello world 2");}});
        var req = { url : "http://asdf.com/hello/somenum", method : "GET"}
        d.dispatch(req, this.res)
        this.res.expectEnd("hello world 2")
    });

    it ("can add a wildcard route", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/hello/', { GET : function(req, res){res.send("hello world");}});
        d.route('/hello/*somenum', { GET : function(req, res){res.end("hello world 2");}});
        var req = { url : "http://asdf.com/hello/1234", method : "GET"}
        d.dispatch(req, this.res)
        this.res.expectEnd("hello world 2")
    });

    it ("throws an exception if the module doesn't implement any methods", function(){
        var d = new detour()
        expectException(
           function(){
             d.route('/', {})
           },
           "HandlerHasNoHttpMethods", 
           "The handler you're trying to route to should implement HTTP methods.",
           ''
        )
    });
  });

	describe('#getUrl', function(){

    it ("throws an error when the path doesn't exist", function(){
        var d = new detour()
        expectException(function(){
          d.getUrl('/')
        }, 'NotFound', 'That route is unknown.', '/');
    });
    it ("throws an error when the name doesn't exist", function(){
        var d = new detour()
        expectException(function(){
          d.getUrl('some_name')
        }, 'NotFound', 'That route name is unknown.', 'some_name');
    });
    it ("returns the url for static path as that static path", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        var url = d.getUrl('/')
        url.should.equal('/')
    });
    it ("throws an error when the given var names are irrelevant", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        expectException(function(){
          var url = d.getUrl('/', {asdf : "asdf"})
        }, 'UnknownVariableName', 
            "One of the provided variable names was unknown.",
            "asdf");
    });
    it ("throws an error when the given var names are insufficient", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/*asdf', simpleModule)
        expectException(function(){
          var url = d.getUrl('/*asdf')
        }, 'MissingVariable', 
            "One of the necessary variables was not provided.",
            "asdf");
    });
    it ("returns the url for a star path with variables injected", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/*asdf', simpleModule)
        var url = d.getUrl('/*asdf', {asdf : 1234})
        url.should.equal('/1234')
    });
    it ("returns the url for a double star path with variables injected", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/*asdf', simpleModule)
        d.route('/*asdf/sub', simpleModule)
        d.route('/*asdf/sub/*sub_id', simpleModule)
        var url = d.getUrl('/*asdf/sub/*sub_id', {asdf : 1234, sub_id : 4567})
        url.should.equal('/1234/sub/4567')
    })
    it ("returns the url for a NAMED double star path with variables injected", function(){
        var d = new detour()
        var simpleModule = this.simpleModule;
        d.route('/', simpleModule)
        d.route('/*asdf', simpleModule)
        d.route('/*asdf/sub', simpleModule)
        d.route('/*asdf/sub/*sub_id', simpleModule)
        d.name('/*asdf/sub/*sub_id', 'subby');
        var url = d.getUrl('subby', {asdf : 1234, sub_id : 4567})
        url.should.equal('/1234/sub/4567')
    })
  })

  describe('#connectRoute', function(){
    it ("is a function that plugs this into express in as middleware", function(){
      var d = new detour()
      var called = false;
      d.dispatch = function(req, res, next){ called = true; }
      d.connectMiddleware({}, {}, function(){});
      called.should.equal(true);
    })
  });

  describe('#dispatch', function(){

    it ("decorates every request object with the detour object as req.detour by default", 
        function(){
          var d = new detour()
          d.route('/', { POST : function(req, res){return "POST";}});
          var req = { url : "http://asdf.com/", method : "POST"}
          d.dispatch(req, this.res)
          should.exist(req.detour)
        }
    );
    it ("decorates req with the detour object as req[d.requestNamespace]",
        function(){
          var d = new detour()
          d.requestNamespace = "router"
          d.route('/', { POST : function(req, res){return "POST";}});
          var req = { url : "http://asdf.com/", method : "POST"}
          d.dispatch(req, this.res)
          should.exist(req.router)
        }
    );

    it ("404s when it doesn't find a matching route and shouldHandle404s is true", function(){
      var d = new detour()
      var req = {url : "http://asdf.com/", method : 'GET'}
      d.dispatch(req, this.res)
      this.res.status.should.equal(404)
      this.res.body.should.equal('')
    })
    it ("calls next() when it doesn't find a matching route and shouldHandle404s is false", function(){
      var d = new detour()
      d.shouldHandle404s = false;
      var req = {url : "http://asdf.com/", method : 'GET'}
      var success = false;
      function next(){success = true;}
      d.dispatch(req, this.res, next)
      this.res.body.should.equal('')
      success.should.equal(true);
    })

    it ("414s if the url is too long", function(){
      var d = new detour()
      var simpleModule = this.simpleModule;
      var bigurl = "1"
      _.times(4097, function(){bigurl += '1';})
      d.route('/', simpleModule)
      var req = { url : bigurl, method : "PUT"}
      d.dispatch(req, this.res)
      this.res.expectStatus(414)
    })

    it ("405s on a resource-unsupported method", function(){
      var d = new detour()
      var simpleModule = this.simpleModule;
      d.route('/', simpleModule)
      d.route('/hello', { GET : function(req, res){res.send("hello world");}});
      var req = { url : "http://asdf.com/hello", method : "PUT"}
      d.dispatch(req, this.res)
      this.res.expectStatus(405)
    })
    it ("500s on a directly thrown exception", function(){
      var d = new detour()
      var simpleModule = this.simpleModule;
      d.route('/', simpleModule)
      d.route('/fail', { GET : function(req, res){ throw 'wthizzle';}});
      var req = { url : "http://asdf.com/fail", method : "GET"}
      d.dispatch(req, this.res)
      this.res.expectStatus(500)
    })

    it ("501s on a server-unsupported method", function(){
      var d = new detour()
      var simpleModule = this.simpleModule;
      d.route('/', simpleModule)
      d.route('/hello', { GET : function(req, res){res.send("hello world");}});
      var req = { url : "http://asdf.com/hello", method : "TRACE"}
      d.dispatch(req, this.res)
      this.res.expectStatus(501)
    })
    it ("can route an object with a POST", function(){
        var d = new detour()
        d.route('/', { POST : function(req, res){return "POST";}});
        var req = { url : "http://asdf.com/", method : "POST"}
        d.dispatch(req, this.res)
        this.res.expectEnd("POST")
    })

    describe("when the method is HEAD", function(){
      // HEAD is the same as GET, but without a response body
      // It should call resource's GET or collectionGET, strip the body, and
      // return the rest.
      it ("404s if the resource doesn't exist", function(){
          var d = new detour()
          var req = { url : "http://asdf.com/asdf", method : "OPTIONS"}
          d.dispatch(req, this.res)
          this.res.expectStatus(404)
      });
      it ("405s if the resource has no GET", function(){
          var d = new detour()
          d.route('/', { POST : function(req, res){return "POST";}});
          var req = { url : "http://asdf.com/", method : "HEAD"}
          d.dispatch(req, this.res)
          this.res.expectStatus(405)
      })
      it ("204s (no body) if the resource has a GET", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.setHeader("Content-Type", 'application/wth');
                              res.end("GET output");
                        }});
          var req = { url : "http://asdf.com/", method : "HEAD"}
          d.dispatch(req, this.res)
          this.res.expectStatus(204)
          this.res.expectHeader("Content-Type", 'application/wth')
      })
    });

    describe ("when the method is OPTIONS", function(){
      it ("404s if the resource doesn't exist", function(){
          var d = new detour()
          var req = { url : "http://asdf.com/asdf", method : "OPTIONS"}
          d.dispatch(req, this.res)
          this.res.expectStatus(404)
      });
      it ("sets the proper headers for OPTIONS if the resource exists", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var req = { url : "http://asdf.com/", method : "OPTIONS"}
          d.dispatch(req, this.res)
          this.res.expectStatus(204)
          this.res.expectHeader('Allow', 'OPTIONS,GET')
      })
    });
    it ("finds and runs a GET handler at a sub path", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/subpath', { 
                              GET : function(req, res){
                                res.end("GET output 2");
                              },
                              DELETE : function(req, res){
                                res.end("delete")
                              }
                            });
          var req = { url : "http://asdf.com/subpath", method : "OPTIONS"}
          d.dispatch(req, this.res)
          this.res.expectStatus(204)
          this.res.expectHeader('Allow', 'OPTIONS,DELETE,GET')
    });

  });



	describe('#getChildUrls', function(){
    it ("throws an exception when given url doesn't exist", function(){
          var d = new detour()
          expectException(function(){
            d.getChildUrls('http://asdf.com');
          }, 'NotFound', 'That route is unknown.', '/');

    });
    it ("gets child urls for a parent path correctly", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var urls = d.getChildUrls('http://asdf.com');
          urls.length.should.equal(1)
          urls[0].should.equal('http://asdf.com/asdf')
    });
    it ("gets multiple child urls for a parent path", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/other', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var urls = d.getChildUrls('http://asdf.com');
          urls.length.should.equal(2)
          urls[0].should.equal('http://asdf.com/asdf')
          urls[1].should.equal('http://asdf.com/other')
    });
    it ("doesn't get grandkids", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf/grankid', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var urls = d.getChildUrls('http://asdf.com');
          urls.length.should.equal(1)
          urls[0].should.equal('http://asdf.com/asdf')
    });
    it ("doesn't get starRoutes", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/*asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var urls = d.getChildUrls('http://asdf.com');
          urls.length.should.equal(0)
    }); 
    it ("can get children of starRoutes", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/*asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/*asdf/grandkid', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var urls = d.getChildUrls('http://asdf.com/1234');
          urls.length.should.equal(1)
          urls[0].should.equal('http://asdf.com/1234/grandkid')
    });
  });
	describe('#getParentUrl', function(){
    it ("throws an exception when getting the parent url of a root node", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          expectException(function(){
            d.getParentUrl('http://asdf.com');
          }, 'NoParentUrl', 'The given path has no parent path', '/');
    });
    it ("returns the parent url for a child path correctly", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var url = d.getParentUrl('http://asdf.com/asdf');
          url.should.equal('http://asdf.com')
    });
    it ("returns the parent url for a grandchild path correctly", function(){
          var d = new detour()
          d.route('/', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf', { GET : function(req, res){
                              res.end("GET output");
                        }});
          d.route('/asdf/grandkid', { GET : function(req, res){
                              res.end("GET output");
                        }});
          var url = d.getParentUrl('http://asdf.com/asdf/grandkid');
          url.should.equal('http://asdf.com/asdf')
    });

  })

});
