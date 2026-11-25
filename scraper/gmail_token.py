#!/usr/bin/env python3
"""Run once on your own computer to get GMAIL_REFRESH_TOKEN (read-only Gmail access).

Usage: python scraper/gmail_token.py <client_id> <client_secret>
Opens Google sign-in in your browser, then prints the refresh token to paste into
the repository secret GMAIL_REFRESH_TOKEN. Nothing is saved to disk.
"""
import http.server
import json
import sys
import urllib.parse
import urllib.request
import webbrowser

if len(sys.argv) != 3:
    sys.exit(__doc__)
cid, secret = sys.argv[1], sys.argv[2]
PORT = 8765
redirect = f"http://127.0.0.1:{PORT}"
url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
    "client_id": cid, "redirect_uri": redirect, "response_type": "code", "access_type": "offline",
    "prompt": "consent", "scope": "https://www.googleapis.com/auth/gmail.readonly"})
code = {}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code["v"] = (q.get("code") or [""])[0]
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Done. You can close this tab.")

    def log_message(self, *a):
        pass


print("Opening:", url)
webbrowser.open(url)
http.server.HTTPServer(("127.0.0.1", PORT), H).handle_request()
body = urllib.parse.urlencode({"code": code.get("v", ""), "client_id": cid, "client_secret": secret,
                               "redirect_uri": redirect, "grant_type": "authorization_code"}).encode()
tok = json.loads(urllib.request.urlopen("https://oauth2.googleapis.com/token", body).read())
print("\nGMAIL_REFRESH_TOKEN =", tok.get("refresh_token") or tok)
