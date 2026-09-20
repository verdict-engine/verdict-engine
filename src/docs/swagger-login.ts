/**
 * Client script injected into the Swagger page (via customJsStr) that adds a "Log in" bar under
 * the API summary. It posts to the public /v1/auth/login and, on success, pushes the bearer token
 * into Swagger's own auth store, so "Try it out" is authenticated without pasting a token into the
 * Authorize dialog. Same-origin, so no CORS. Kept out of main.ts to keep bootstrap wiring-only;
 * written with no template literals or ${} so it embeds verbatim.
 */
export const SWAGGER_LOGIN_JS = `(function () {
  function mount() {
    if (!window.ui) return setTimeout(mount, 100);
    var info = document.querySelector(".swagger-ui .information-container .info");
    if (!info) return setTimeout(mount, 100);
    if (document.getElementById("vd-login-bar")) return;

    var bar = document.createElement("div");
    bar.id = "vd-login-bar";
    bar.style.cssText =
      "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0;padding:12px 16px;border:1px solid #d5dae2;border-radius:8px;background:#fafbfc;font-family:sans-serif";
    bar.innerHTML =
      '<strong style="font-size:14px">Log in</strong>' +
      '<input id="vd-email" placeholder="email" value="admin@verdict.local" autocomplete="username" style="padding:7px 9px;border:1px solid #ccd2da;border-radius:6px;min-width:200px">' +
      '<input id="vd-pass" type="password" placeholder="password" autocomplete="current-password" style="padding:7px 9px;border:1px solid #ccd2da;border-radius:6px;min-width:160px">' +
      '<button id="vd-login" style="padding:7px 16px;border:0;border-radius:6px;background:#4a6cf7;color:#fff;font-weight:600;cursor:pointer">Authorize</button>' +
      '<button id="vd-logout" style="padding:7px 12px;border:1px solid #ccd2da;border-radius:6px;background:#fff;cursor:pointer;display:none">Log out</button>' +
      '<span id="vd-msg" style="font-size:13px;color:#5b6675"></span>';
    info.appendChild(bar);

    var msg = document.getElementById("vd-msg");
    var logoutBtn = document.getElementById("vd-logout");

    function authorize(token, role) {
      window.ui.authActions.authorize({
        bearer: { name: "bearer", schema: { type: "http", scheme: "bearer" }, value: token },
      });
      msg.textContent = "Authorized as " + (role || "operator") + " — try any endpoint below.";
      msg.style.color = "#0a8043";
      logoutBtn.style.display = "";
    }

    document.getElementById("vd-login").onclick = function () {
      var email = document.getElementById("vd-email").value.trim();
      var password = document.getElementById("vd-pass").value;
      msg.style.color = "#5b6675";
      msg.textContent = "Signing in…";
      fetch("/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email, password: password }),
      })
        .then(function (r) {
          return r.json().then(function (b) {
            return { ok: r.ok, body: b };
          });
        })
        .then(function (res) {
          if (!res.ok || !res.body || !res.body.token) {
            msg.style.color = "#d1242f";
            msg.textContent = (res.body && res.body.message) || "Login failed — check credentials.";
            return;
          }
          authorize(res.body.token, res.body.user && res.body.user.role);
        })
        .catch(function () {
          msg.style.color = "#d1242f";
          msg.textContent = "Could not reach the engine.";
        });
    };

    logoutBtn.onclick = function () {
      window.ui.authActions.logout(["bearer"]);
      msg.textContent = "Logged out.";
      msg.style.color = "#5b6675";
      logoutBtn.style.display = "none";
    };
  }
  mount();
})();`;
