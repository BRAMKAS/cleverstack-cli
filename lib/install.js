var Promise     = require('bluebird')
  , path        = require('path')
  , _           = require('lodash')
  , https       = require('follow-redirects').https
  , proxyAgent  = require('https-proxy-agent')
  , async       = require('async')
  , utils       = GLOBAL.lib.utils
  , search      = GLOBAL.lib.search
  , packages    = GLOBAL.lib.packages
  , util        = GLOBAL.lib.util;

/**
 * Launches the installation process
 * Checks for seed folders depending on CWD
 * Separates which packages we need via Bower and NPM
 * Installs the NPM/Bower modules within the seeds
 *
 * @param  {Array} repos
 * @return {Promise}
 * @api private
 */
function install(repos) {
  return new Promise(function(resolve, reject) {
    util.locations
      .findAvailableCommands()
      .spread(function(locations) {
        return search.aggregate(repos).spread(function(npm, bower) {
          return [ locations, npm, bower ];
        });
      })
      .spread(function(locations, npm, bower) {
        var actions = []
         // todo: make this into a function...
         // todo: also make packages.locations() a prototype for .isBackend() utility functions, etc.
          , backend = _.find(locations, function(location) {
            return location.name === 'backend';
          })
          , frontend = _.find(locations, function(location) {
            return location.name === 'frontend';
          });

        if (typeof backend === 'undefined' && frontend === 'undefined') {
          utils.fail('Couldn\'t find a CleverStack seed. Please make sure that you\'re trying to install within your CleverStack project.');
        }

        if (typeof backend === 'undefined') {
          npm = [];
        }

        if (typeof frontend === 'undefined') {
          bower = [];
        }

        if (npm.length < 1 && bower.length < 1) {
          utils.fail('No modules to install, please make sure you\'re tring to install CleverStack compatible modules and that you\'re in the correct seed folder.');
        }

        if (npm.length > 0) {
          actions.push(packages.installWithNpm(backend, npm));
        }

        if (bower.length > 0) {
          actions.push(packages.installWithBower(frontend, bower));
        }

        Promise
          .all(actions)
          .then(function() {
            resolve([ backend, frontend, npm, bower ]);
          })
          .catch(function(err) {
            reject(err);
          });
      })
      .catch(function(err) {
        reject(err);
      });
  });
}

function installBackendModules(backendPath, npm) {
  return new Promise(function(resolve, reject) {
    npm = npm.map(function(n) {
      return n.name;
    });

    var walker = require('findit')(path.join(backendPath.moduleDir, backendPath.modulePath))
      , dirs   = [];

    walker.on('directory', function(dir, stat, stop) {
      var _dirs = dir.split(path.sep)
        , _dir  = _dirs.pop()
        , mdir  = path.dirname(dir).split(path.sep).pop();

      if (mdir === 'modules') {
        if (npm.indexOf(_dir) === -1) {
          return stop();
        }

        dirs.push(path.join(_dirs.join(path.sep), _dir));
      }
    });

    walker.on('end', function() {
      if (dirs.length > 0) {
        lib.utils.info([ '  Installing module peerDependencies...' ].join(''));

        async.each(
          dirs,
          function installModulePeerDependencies(dir, installed) {
            util
              .dependencies
              .installPeerDependencies(dir, path.join(backendPath.moduleDir, backendPath.modulePath))
              .then(function () {
                installed();
              })
              .catch(installed);
          },
          function peerDependenciesInstalled(err) {
            if (!!err) {
              return reject(err);
            }

            async.eachSeries(
              npm,
              function(module, next) {
                util
                  .grunt
                  .runTasks(backendPath.moduleDir, path.join(backendPath.moduleDir, backendPath.modulePath, module))
                  .then(next, next);
              },
              function( err) {
                if (!!err) {
                  return reject(err);
                }

                resolve();
              }
            );
          }
        );
      }
    });
  });
}


exports.run = function(args) {
  return new Promise(function(resolve, reject) {
    install(args)
      .spread(function(backendPath, frontendPath, npm /*, bower */) {
        var actions = [];

        if (npm.length > 0) {
          actions.push(installBackendModules(backendPath, npm));
        }

        Promise
          .all(actions)
          .then(function runNpmTasksForModules() {
            resolve();
          })
          .catch(reject);
      })
      .catch(reject);
  });
};

/**
 * Returns JSON object from an HTTP(S) request
 *
 * @param  {Object} options HTTP Object
 * @return {Promise}        Returns a promise from bluebird
 * @public
 */
exports.getJSON = function(options) {
  // Handle HTTP_PROXY and HTTPS_PROXY environment variables
  var proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
  if (proxy !== null) {
    options.agent = new proxyAgent(proxy);
  }

  return new Promise(function(resolve) {
    var req = https.request(options, function(res) {
      res.setEncoding('utf-8');

      if (res.statusCode !== 200) {
        return resolve();
      }

      var responseString = '';

      res.on('data', function(data) {
        responseString += data;
      });

      res.on('end', function() {
        var body = JSON.parse(responseString);
        resolve(body);
      });
    });

    req.end();
  });
};
