## Oblivious DNS-over-HTTPS Proxy

A Cloudflare Workers endpoint (proxy) to an upstream Oblivious DNS-over-HTTPS target.

[RFC9230](https://datatracker.ietf.org/doc/rfc9230/):

*Oblivious Proxy* is a HTTP server that proxies encrypted DNS messages between *Oblivious Client* and *Oblivious Target*
as identified by a URI Template as in [RFC6570](https://datatracker.ietf.org/doc/rfc6570) (see Section 4.1).
*Oblivious Proxy* is not a full HTTP proxy but a specialized server that forwards Oblivious DNS messages.

```
        --- [ Request encrypted with Target public key ] -->
   +---------+             +-----------+             +-----------+
   | Client  +-------------> Oblivious +-------------> Oblivious |
   |         <-------------+   Proxy   <-------------+  Target   |
   +---------+             +-----------+             +-----------+
       <-- [   Response encrypted with symmetric key   ] ---
```
