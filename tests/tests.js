/* eslint-disable */
// What a device can answer WITHOUT a person: the API is there, the native SDK starts with a DSN that reaches nothing, a second start
// is answered without restarting, and the scope calls are accepted. The crash stays out of the automatic tests on purpose: it takes
// the test app down with it, and the report it leaves is for Sentry's side to show. Written for Jasmine 2 as
// cordova-plugin-test-framework runs it, in plain ES5; test/unit/device-tests.test.mjs runs the same tests on Node.

// A DSN whose host answers nothing: the SDK starts and keeps its envelopes, and no real project receives a test session.
var DSN = 'https://0123456789abcdef0123456789abcdef@127.0.0.1:9/1';

exports.defineAutoTests = function () {
  var api = window.SentrySdk;

  function failWith(done) {
    return function (error) {
      fail('the call was refused: ' + error);
      done();
    };
  }

  describe('SentrySdk (window.SentrySdk)', function () {
    it('is defined, with the whole API', function () {
      expect(api).toBeDefined();
      ['start', 'setUser', 'setTags', 'setContext', 'setExtras', 'close', 'isEnabled', 'crash'].forEach(function (name) {
        expect(typeof api[name]).toBe('function');
      });
    });
  });

  describe('start', function () {
    it('refuses an options object without a dsn', function (done) {
      api.start({ dsn: '' }).then(
        function () {
          fail('a start without a dsn was accepted');
          done();
        },
        function (error) {
          expect(String(error)).toMatch(/dsn/);
          done();
        },
      );
    });

    it('starts the native SDK once, and answers a second start without restarting', function (done) {
      api
        .start({ dsn: DSN, release: 'tests@0.1.0', environment: 'test', appHangTimeoutInterval: 7 })
        .then(function (first) {
          expect(['started', 'already started']).toContain(first);
          return api.start({ dsn: DSN });
        })
        .then(function (second) {
          expect(second).toBe('already started');
          done();
        }, failWith(done));
    });
  });

  describe('isEnabled and close', function () {
    // close stops the SDK, and the other specs start it again themselves, so this one leaves it running as it found it.
    it('says whether the SDK is running, closes it, and starts again after', function (done) {
      api
        .start({ dsn: DSN })
        .then(function () {
          return api.isEnabled();
        })
        .then(function (enabled) {
          expect(enabled).toBe(true);
          return api.close();
        })
        .then(function (closed) {
          expect(closed).toBe('closed');
          return api.isEnabled();
        })
        .then(function (enabled) {
          expect(enabled).toBe(false);
          return api.close();
        })
        .then(function (closedAgain) {
          expect(closedAgain).toBe('not running');
          return api.start({ dsn: DSN });
        })
        .then(function (restarted) {
          expect(restarted).toBe('started');
          done();
        }, failWith(done));
    });
  });

  describe('crash', function () {
    it('is refused unless start was given allowCrash, so a stray call cannot end the app', function (done) {
      api
        .start({ dsn: DSN })
        .then(function () {
          return api.crash();
        })
        .then(
          function () {
            fail('a crash that start never allowed went ahead');
            done();
          },
          function (error) {
            expect(String(error)).toMatch(/allowCrash/);
            done();
          },
        );
    });
  });

  describe('the scope', function () {
    // A scope call is applied while the SDK is running, and kept for `start` before that (it answers "queued"). Jasmine runs the specs
    // in a random order, so each of these starts the SDK first; a start after another spec's answers "already started".
    function running() {
      return api.start({ dsn: DSN });
    }

    it('takes a user, and clears it with null', function (done) {
      running()
        .then(function () {
          return api.setUser({ id: '42', email: 'user@example.com', username: 'tester' });
        })
        .then(function (set) {
          expect(set).toBe('set');
          return api.setUser(null);
        })
        .then(function (cleared) {
          expect(cleared).toBe('cleared');
          done();
        }, failWith(done));
    });

    it('takes extras, with null removing one', function (done) {
      running()
        .then(function () {
          return api.setExtras({ plain: 'text', count: 12, nested: { a: [1, 2] }, gone: null });
        })
        .then(function (set) {
          expect(set).toBe('set');
          done();
        }, failWith(done));
    });

    it('takes tags, with null removing one, and a context', function (done) {
      running()
        .then(function () {
          return api.setTags({ 'account.region': 'IE', premium: true, gone: null });
        })
        .then(function (set) {
          expect(set).toBe('set');
          return api.setContext('account', { animals: 120, premium: true });
        })
        .then(function (set) {
          expect(set).toBe('set');
          return api.setContext('account', null);
        })
        .then(function (removed) {
          expect(removed).toBe('set');
          done();
        }, failWith(done));
    });
  });
};

exports.defineManualTests = function (contentEl, createActionButton) {
  contentEl.innerHTML =
    '<p>Crash: the process goes down. The button starts the SDK with allowCrash, which is what lets a crash through, against a DSN that ' +
    'reaches nothing, so no report is sent; use the demo app with a real DSN to see one in Sentry.</p>';
  createActionButton('Crash the process natively', function () {
    window.SentrySdk.start({ dsn: DSN, allowCrash: true }).then(function () {
      window.SentrySdk.crash();
    });
  });
};
