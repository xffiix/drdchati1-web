const fs = require("fs");
const WebSocket = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");

/* ========= إعدادات ========= */

const LISTEN_PORT = process.env.PORT || 3000;

// السيرفر الحقيقي الذي يتصل به 2conn.js أصلاً
const REAL_WSS_URL = "wss://REAL-DOMAIN-HERE";

/* ========= تحميل البروكسيات ========= */

const proxies = fs
  .readFileSync("proxy.txt", "utf8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean);

let proxyIndex = 0;

function getNextProxy() {
  const proxy = proxies[proxyIndex];
  proxyIndex = (proxyIndex + 1) % proxies.length;
  return proxy;
}

/* ========= WebSocket Server ========= */

const wss = new WebSocket.Server({ port: LISTEN_PORT });

console.log("WSS Proxy running on port", LISTEN_PORT);

wss.on("connection", (clientWs, req) => {
  console.log("🔗 New client connection");

  const proxy = getNextProxy();
  console.log("🌍 Using proxy:", proxy);

  const agent = new HttpsProxyAgent(proxy);

  const remoteWs = new WebSocket(REAL_WSS_URL, {
    agent,
    headers: {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0"
    }
  });

  let injected = false;

  /* ===== من المتصفح → السيرفر الحقيقي ===== */

  clientWs.on("message", (data) => {
    if (!injected) {
      injected = true;

      console.log("💉 Injecting first frame");

      // ===== هنا يتم الحقن (مرة واحدة فقط) =====
      // لا نلمس 2conn.js
      // نعدل أول رسالة فقط قبل إرسالها

      let modified = data;

      try {
        const text = data.toString();

        // مثال (عدّل المنطق حسب بروتوكولك الحقيقي)
        // بدون كسر أي متغيرات في 2conn.js
        const injectedText =
          text +
          "\n" +
          JSON.stringify({
            __inject: true,
            ts: Date.now()
          });

        modified = Buffer.from(injectedText);
      } catch (e) {
        // لو Binary نمرره كما هو
      }

      remoteWs.send(modified);
      return;
    }

    remoteWs.send(data);
  });

  /* ===== من السيرفر الحقيقي → المتصفح ===== */

  remoteWs.on("message", (data) => {
    clientWs.send(data);
  });

  /* ===== إدارة الإغلاق ===== */

  clientWs.on("close", () => {
    remoteWs.close();
    console.log("❌ Client disconnected");
  });

  remoteWs.on("close", () => {
    clientWs.close();
    console.log("❌ Remote disconnected");
  });

  clientWs.on("error", () => remoteWs.close());
  remoteWs.on("error", () => clientWs.close());
});
