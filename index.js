// SPDX-License-Identifier: 0BSD

const FWD = "fwd";
const FWD_STREAMED = 0; // default
const FWD_BUFFERED = 2;
const FWD_CLONED = 1;
const HDR_CONTENT_LEN = "Content-Length";
const ODOH_METHOD = "POST";
const ODOH_TARGETHOST = "targethost";
const ODOH_TARGETPATH = "targetpath";
const ODOH_ENDPOINT_NAME = "RethinkDNS";

const ODOH_HDR_ACCEPT = { Accept: "application/oblivious-dns-message" };
const ODOH_HDR_CONTENT_TYPE = {
  "Content-Type": "application/oblivious-dns-message",
};
const ODOH_HDR_CACHE_CONTROL = { "Cache-Control": "no-cache, no-store" };
// datatracker.ietf.org/doc/rfc9230/ (section 4.1)
const ODOH_HDR_PROXY_ERR = {
  "Proxy-Status": ODOH_ENDPOINT_NAME + "; error=http_request_error",
};

function proxyStatusHdr(code) {
  return { "Proxy-Status": `${ODOH_ENDPOINT_NAME}; received-status=${code}` };
}

function proxyStatusKV(code) {
  return {
    k: "Proxy-Status",
    v: `${ODOH_ENDPOINT_NAME}; received-status=${code}`,
  };
}

/**
 * @param {string} txt
 * @returns {Response}
 */
function r500(txt) {
  return new Response(null, {
    status: 500,
    statusText: txt,
    headers: { ...ODOH_HDR_PROXY_ERR },
  });
}

/**
 * @param {string} txt
 * @returns {Response}
 */
function r400(txt) {
  return new Response(null, {
    status: 400,
    statusText: txt,
    headers: { ...ODOH_HDR_PROXY_ERR },
  });
}

/**
 * @param {Response} r
 * @param {Request} fwdreq
 * @returns {Response}
 */
function response(r, fwdreq) {
  // rename the headers as Snippets snips some out (like the "Location" header)
  const orighdrs = {};
  let h = 0;
  let f = 0;
  for (const [k, v] of r.headers) {
    orighdrs[`x-${k}`] = v;
    h++;
  }
  for (const [k, v] of fwdreq.headers) {
    orighdrs[`x-fwdreq-${k}`] = v;
    f++;
  }
  orighdrs["x-orig-hdr-count"] = h + "";
  orighdrs["x-fwdreq-hdr-count"] = f + "";
  return new Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: {
      ...orighdrs,
      ...ODOH_HDR_CONTENT_TYPE,
      ...proxyStatusHdr(r.status),
    },
  });
}

/**
 * @param {URL} u
 * @param {Request} r
 * @returns {Request}
 */
function request(u, r) {
  const len = hdr(r.headers, HDR_CONTENT_LEN, "0");
  return new Request(u, {
    method: ODOH_METHOD,
    body: r.body,
    headers: {
      ...ODOH_HDR_CONTENT_TYPE,
      ...ODOH_HDR_CACHE_CONTROL,
      ...ODOH_HDR_ACCEPT,
      HDR_CONTENT_LEN: len,
    },
  });
}

/**
 * @param {URL} u
 * @param {Request} r
 * @returns {Request}
 */
function clonedRequest(u, r) {
  // to follow redirects
  // stackoverflow.com/questions/55920957
  return new Request(u, r);
}

/**
 * @param {URL} u
 * @param {ArrayBuffer} body
 * @returns {Request}
 */
function bufferedRequest(u, body) {
  let len = "0";
  if (body) {
    len = body.byteLength + "";
  }
  // to follow redirects
  // stackoverflow.com/questions/55920957
  return new Request(u, {
    method: ODOH_METHOD,
    body: body,
    headers: {
      ...ODOH_HDR_CONTENT_TYPE,
      ...ODOH_HDR_CACHE_CONTROL,
      ...ODOH_HDR_ACCEPT,
      HDR_CONTENT_LEN: len,
    },
  });
}

/**
 * @param {Response} r
 * @param {Request} fwdreq
 * @returns {Response}
 */
function cloneResponse(r, fwdreq) {
  const rr = new Response(r.body, r);
  const pkv = proxyStatusKV(r.status);
  rr.headers.set(pkv.k, pkv.v);
  for (const [k, v] of fwdreq.headers) {
    rr.headers.set(`x-fwdreq-${k}`, v);
  }
  return rr;
}

/**
 * 
 * @param {Headers} h 
 * @param {string} k 
 * @param {string} d 
 */
function hdr(h, k, d) {
  if (!h || !k || h instanceof Headers === false) {
    return d;
  }
  return h.get(k) || d;
}

/**
 *
 * @param {URL} url
 * @param {string} name
 * @returns {string}
 */
function param(url, name) {
  if (!url || !name) {
    return "";
  }
  return url.searchParams.get(name) || "";
}

/**
 *
 * @param {URL} url
 * @param {string} name
 * @returns {string}
 */
function at(url, name) {
  if (!url || !name) {
    return "";
  }

  const path = url.pathname;
  if (!path || path === "/") {
    return "";
  }
  const p = path.split("/");
  let i = Number.MAX_SAFE_INTEGER;
  if (name === ODOH_TARGETHOST) {
    i = 1;
  } else if (name === ODOH_TARGETPATH) {
    i = 2;
  } else if (name === FWD) {
    i = 3;
  }
  if (p.length > i) {
    return p[i];
  }
  return "";
}

function get(url, name) {
  return param(url, name) || at(url, name);
}

function ensureLeadingSlash(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Proxy the ODoH request to the target host/path and return the response.
 * @param {Request} req
 * @returns {Response}
 */
async function handleRequest(req) {
  try {
    // https://odoh.proxy/dns-query?targethost=&targetpath=
    // https://odoh.proxy/{targethost}/{targetpath}
    const u = new URL(req.url);
    const host = get(u, ODOH_TARGETHOST);
    const path0 = get(u, ODOH_TARGETPATH);
    const fwd = get(u, FWD);
    if (req.method !== ODOH_METHOD) {
      return r500(`Only ${ODOH_METHOD}`);
    }
    if (!host) {
      return r400(`Missing ${ODOH_TARGETHOST}`);
    }
    if (!path0) {
      return r400(`Missing ${ODOH_TARGETPATH}`);
    }
    // ensure targetPath starts with a slash
    const path = ensureLeadingSlash(path0);

    const target = `https://${host}${path}`;

    if (fwd == FWD_BUFFERED) {
      // == string or number
      // if redirected by the target:
      // with "fetch(bufferedRequest())" => 1022 Snippets exceeded subrequests limit
      const body = await req.arrayBuffer();
      const fwdreq = bufferedRequest(target, body);
      const downstream = await fetch(fwdreq);
      return cloneResponse(downstream, fwdreq);
    } else if (fwd == FWD_CLONED) {
      // if redirected by the target:
      // with "return cloneResponse()" => 405 Method Not Allowed
      // with "return response()" => 301 Moved Permanently
      const fwdreq = clonedRequest(target, req);
      const downstream = await fetch(fwdreq);
      return response(downstream, fwdreq);
    } else {
      // fwd == FWD_STREAMED
      // if redirected by the target:
      // with "return clonedResponse()" => 500 Internal Server Error
      const fwdreq = request(target, req);
      const downstream = await fetch(fwdreq);
      return cloneResponse(downstream, fwdreq);
    }
  } catch (err) {
    console.error(err);
    return r500(err.message);
  }
}

// developers.cloudflare.com/workers/runtime-apis/fetch-event/#syntax-module-worker
export default {
  async fetch(r, env, ctx) {
    return handleRequest(r);
  },
};
