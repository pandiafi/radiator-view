/*
Build type:
{
   repository: name,
   branch: 'master',
   started: new Date(),
   state: 'success',
   commit: {
      created: new Date(),
      author: 'Tester',
      hash: 'shahash'
   }
}
*/

function buildBackend(settings, callback) {
  var backend = circleBackend;
  if (settings.mode === "travis") {
    backend = travisBackend;
  } else if (settings.mode === "jenkins") {
    backend = jenkinsBackend;
  } else if (settings.mode === "cloudwatch") {
    backend = cloudWatchBackend;
  } else if (settings.mode === "drone") {
    backend = droneBackend;
  }
  var stateFilter = function(build) {
    return build.state;
  };
  var authorFilter = function(build) {
    return build.commit.author;
  };
  var branchFilter = function(build) {
    return settings.branch ? build.branch.match(settings.branch) : true;
  };
  return function() {
    backend(settings, function(err, data) {
      if (err) {
        return callback(err);
      }
      var builds = data
        .filter(stateFilter)
        .filter(authorFilter)
        .filter(branchFilter);
      builds = _.uniqBy(builds, function(b) {
        return b.repository + b.branch;
      });
      builds = builds.sort(function(a, b) {
        return a.started.getTime() - b.started.getTime();
      });
      callback(undefined, builds);
    });
  };
}

function backendOptions() {
  return {
    circle: {
      name: "Circle CI",
      url: "https://circleci.com/api/v1/projects",
      token: undefined
    }
  };
}

function httpRequest(url, handler /*, headers */) {
  var request = new XMLHttpRequest();
  var headers = arguments[2] || {};
  request.open("GET", url, true);
  Object.keys(headers).forEach(function(headerName) {
    request.setRequestHeader(headerName, headers[headerName]);
  });
  request.onload = function() {
    if (request.status === 401 || request.status === 403) {
      handler(
        "Invalid API token (" +
          request.status +
          " " +
          request.responseText +
          ")"
      );
    } else if (request.status >= 200 && request.status < 400) {
      try {
        var data = JSON.parse(request.responseText);
        handler(undefined, data);
      } catch (exc) {
        console.log("Error fetching URL", url, request.responseText);
        handler(exc);
      }
    } else {
      handler("Error getting URL " + url + ":" + request.status);
    }
  };
  request.send();
}

var circleBackend = function(settings, resultCallback) {
  var url = settings.url + "?circle-token=" + settings.token;

  httpRequest(
    url,
    function(err, data) {
      if (err) {
        return resultCallback(err);
      }
      var builds = data.reduce(function(acc, repository) {
        return acc.concat(
          Object.keys(repository.branches).map(function(branchName) {
            var branch = repository.branches[branchName];
            var buildIsRunning =
              branch.running_builds == undefined
                ? false
                : branch.running_builds.length != 0;
            if (branch.running_builds == undefined) var build = "";
            else
              var build = buildIsRunning
                ? branch.running_builds[0]
                : branch.recent_builds[0];
            var status = buildIsRunning ? build.status : build.outcome;
            var authors = branch.pusher_logins
              ? branch.pusher_logins.join(",")
              : undefined;
            return {
              repository: repository.reponame,
              branch: branchName,
              started: new Date(build.pushed_at),
              state: status,
              commit: {
                created: new Date(build.pushed_at),
                author: authors,
                hash: build.vcs_revision
              }
            };
          })
        );
      }, []);
      resultCallback(undefined, builds);
    },
    {
      Accept: "application/json"
    }
  );
};
