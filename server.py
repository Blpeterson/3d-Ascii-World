"""Zero-dependency development server for Endless City."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import webbrowser
from threading import Timer

HOST, PORT = "127.0.0.1", 8000

if __name__ == "__main__":
    url = f"http://{HOST}:{PORT}"
    print(f"ENDLESS//CITY running at {url}  (Ctrl+C to stop)")
    Timer(0.5, lambda: webbrowser.open(url)).start()
    ThreadingHTTPServer((HOST, PORT), SimpleHTTPRequestHandler).serve_forever()
