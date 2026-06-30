import hashlib
import http.server
import json
import os
import secrets
import socketserver
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote_plus

ROOT_DIR = Path(__file__).resolve().parent
DATA_FILE = ROOT_DIR / "data.json"
PORT = 65432
SESSION_COOKIE = "shoplist_session"
HASH_ITERATIONS = 200_000


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ITERATIONS)
    return f"{salt.hex()}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ITERATIONS)
    return secrets.compare_digest(actual, expected)


def load_data() -> dict:
    if not DATA_FILE.exists():
        initial = {
            "users": {},
            "lists": {},
            "sessions": {},
        }
        save_data(initial)
        return initial
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_data(data: dict) -> None:
    tmp = DATA_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    tmp.replace(DATA_FILE)


data = load_data()


def get_username_from_cookie(cookie_header: str | None) -> str | None:
    if not cookie_header:
        return None
    parts = cookie_header.split(";")
    for part in parts:
        if "=" not in part:
            continue
        name, value = part.strip().split("=", 1)
        if name == SESSION_COOKIE:
            session = data.get("sessions", {}).get(value)
            if session:
                return session.get("user")
    return None


def get_accessible_lists(username: str) -> list[dict]:
    result = []
    for list_id, shopping_list in data["lists"].items():
        if shopping_list["owner"] == username or username in shopping_list["members"]:
            result.append({
                "id": list_id,
                "title": shopping_list["title"],
                "owner": shopping_list["owner"],
                "members": shopping_list["members"],
                "items": shopping_list["items"],
            })
    return result


def create_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    data.setdefault("sessions", {})[token] = {"user": username, "created": datetime.utcnow().isoformat()}
    save_data(data)
    return token


def clear_session(token: str) -> None:
    if token in data.get("sessions", {}):
        del data["sessions"][token]
        save_data(data)


class ShopHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            self.path = "/static/index.html"
            return super().do_GET()
        if path.startswith("/api/"):
            return self.handle_api_get(path)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            return self.handle_api_post(path)
        self.send_error(404, "Not Found")

    def handle_api_get(self, path: str):
        user = get_username_from_cookie(self.headers.get("Cookie"))
        if path == "/api/check":
            if user:
                return self.send_json({"user": user})
            return self.send_json({"user": None})
        if path == "/api/user":
            if not user:
                return self.send_json({"error": "unauthorized"}, status=401)
            return self.send_json({"user": user, "remembered": self.get_query_param("remember")})
        if path == "/api/lists":
            if not user:
                return self.send_json({"error": "unauthorized"}, status=401)
            return self.send_json({"lists": get_accessible_lists(user)})
        return self.send_json({"error": "unknown endpoint"}, status=404)

    def handle_api_post(self, path: str):
        if path == "/api/login":
            return self.handle_login()
        if path == "/api/signup":
            return self.handle_signup()
        if path == "/api/logout":
            return self.handle_logout()
        if path == "/api/list/create":
            return self.handle_create_list()
        if path == "/api/list/share":
            return self.handle_share_list()
        if path == "/api/list/item/add":
            return self.handle_add_item()
        if path == "/api/list/item/check":
            return self.handle_check_item()
        if path == "/api/list/shopping/finish":
            return self.handle_finish_shopping()
        return self.send_json({"error": "unknown endpoint"}, status=404)

    def handle_login(self):
        payload = self.parse_json_body()
        username = payload.get("username", "").strip()
        password = payload.get("password", "")
        if not username or not password:
            return self.send_json({"error": "missing username or password"}, status=400)
        user = data["users"].get(username)
        if not user or not verify_password(password, user["password"]):
            return self.send_json({"error": "invalid credentials"}, status=401)
        token = create_session(username)
        self.send_json({"ok": True, "user": username}, headers={"Set-Cookie": f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax"})

    def handle_signup(self):
        payload = self.parse_json_body()
        username = payload.get("username", "").strip()
        password = payload.get("password", "")
        if not username or not password:
            return self.send_json({"error": "missing username or password"}, status=400)
        if username in data["users"]:
            return self.send_json({"error": "username already exists"}, status=409)
        data["users"][username] = {"password": hash_password(password)}
        save_data(data)
        token = create_session(username)
        self.send_json({"ok": True, "user": username}, headers={"Set-Cookie": f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax"})

    def handle_logout(self):
        cookie = self.headers.get("Cookie", "")
        token = None
        for part in cookie.split(";"):
            if "=" not in part:
                continue
            name, value = part.strip().split("=", 1)
            if name == SESSION_COOKIE:
                token = value
                break
        if token:
            clear_session(token)
        self.send_json({"ok": True}, headers={"Set-Cookie": f"{SESSION_COOKIE}=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"})

    def handle_create_list(self):
        user = get_username_from_cookie(self.headers.get("Cookie"))
        if not user:
            return self.send_json({"error": "unauthorized"}, status=401)
        payload = self.parse_json_body()
        title = payload.get("title", "").strip()
        if not title:
            return self.send_json({"error": "title required"}, status=400)
        list_id = secrets.token_hex(8)
        data["lists"][list_id] = {
            "id": list_id,
            "title": title,
            "owner": user,
            "members": [],
            "items": [],
            "created_at": datetime.utcnow().isoformat(),
        }
        save_data(data)
        return self.send_json({"ok": True, "list": data["lists"][list_id]})

    def handle_share_list(self):
        user = get_username_from_cookie(self.headers.get("Cookie"))
        if not user:
            return self.send_json({"error": "unauthorized"}, status=401)
        payload = self.parse_json_body()
        list_id = payload.get("list_id")
        target = payload.get("username", "").strip()
        if not list_id or not target:
            return self.send_json({"error": "list_id and username required"}, status=400)
        shopping_list = data["lists"].get(list_id)
        if not shopping_list:
            return self.send_json({"error": "list not found"}, status=404)
        if shopping_list["owner"] != user:
            return self.send_json({"error": "only owner can share list"}, status=403)
        if target not in data["users"]:
            return self.send_json({"error": "target user not found"}, status=404)
        if target == user:
            return self.send_json({"error": "owner already has access"}, status=400)
        if target not in shopping_list["members"]:
            shopping_list["members"].append(target)
            save_data(data)
        return self.send_json({"ok": True, "members": shopping_list["members"]})

    def handle_add_item(self):
        user = get_username_from_cookie(self.headers.get("Cookie"))
        if not user:
            return self.send_json({"error": "unauthorized"}, status=401)
        payload = self.parse_json_body()
        list_id = payload.get("list_id")
        label = payload.get("label", "").strip()
        quantity = payload.get("quantity")
        unit = payload.get("unit")
        category = payload.get("category", "other")
        if not list_id or not label or not quantity or not unit:
            return self.send_json({"error": "list_id, label, quantity and unit are required"}, status=400)
        try:
            quantity_value = float(quantity)
        except (TypeError, ValueError):
            return self.send_json({"error": "quantity must be a number"}, status=400)
        shopping_list = data["lists"].get(list_id)
        if not shopping_list or (shopping_list["owner"] != user and user not in shopping_list["members"]):
            return self.send_json({"error": "list not found or access denied"}, status=403)
        item_id = secrets.token_hex(8)
        shopping_list["items"].append({
            "id": item_id,
            "label": label,
            "quantity": quantity_value,
            "unit": unit,
            "category": category,
            "checked": False,
            "created_at": datetime.utcnow().isoformat(),
        })
        save_data(data)
        return self.send_json({"ok": True, "item": shopping_list["items"][-1]})

    def handle_check_item(self):
        user = get_username_from_cookie(self.headers.get("Cookie"))
        if not user:
            return self.send_json({"error": "unauthorized"}, status=401)
        payload = self.parse_json_body()
        list_id = payload.get("list_id")
        item_id = payload.get("item_id")
        action = payload.get("action")
        partial = payload.get("partial_quantity")
        shopping_list = data["lists"].get(list_id)
        if not shopping_list or (shopping_list["owner"] != user and user not in shopping_list["members"]):
            return self.send_json({"error": "list not found or access denied"}, status=403)
        item = next((it for it in shopping_list["items"] if it["id"] == item_id), None)
        if not item:
            return self.send_json({"error": "item not found"}, status=404)
        if action == "check":
            item["checked"] = True
        elif action == "uncheck":
            item["checked"] = False
        elif action == "partial":
            try:
                partial_qty = float(partial)
            except (TypeError, ValueError):
                return self.send_json({"error": "invalid partial_quantity"}, status=400)
            if partial_qty <= 0:
                return self.send_json({"error": "partial quantity must be positive"}, status=400)
            if partial_qty >= item["quantity"]:
                item["quantity"] = 0
                item["checked"] = True
            else:
                item["quantity"] = round(item["quantity"] - partial_qty, 3)
                item["checked"] = False
        else:
            return self.send_json({"error": "unknown action"}, status=400)
        save_data(data)
        return self.send_json({"ok": True, "item": item})

    def handle_finish_shopping(self):
        user = get_username_from_cookie(self.headers.get("Cookie"))
        if not user:
            return self.send_json({"error": "unauthorized"}, status=401)
        payload = self.parse_json_body()
        list_id = payload.get("list_id")
        shopping_list = data["lists"].get(list_id)
        if not shopping_list or (shopping_list["owner"] != user and user not in shopping_list["members"]):
            return self.send_json({"error": "list not found or access denied"}, status=403)
        shopping_list["items"] = [item for item in shopping_list["items"] if not item.get("checked")]
        save_data(data)
        return self.send_json({"ok": True})

    def parse_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw_data = self.rfile.read(length) if length else b""
        if not raw_data:
            return {}
        try:
            return json.loads(raw_data.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def send_json(self, payload: dict, status: int = 200, headers: dict | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if headers:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def get_query_param(self, name: str) -> str | None:
        query = self.path.split("?", 1)[-1] if "?" in self.path else ""
        if not query:
            return None
        params = parse_qs(query)
        values = params.get(name)
        if values:
            return unquote_plus(values[0])
        return None


if __name__ == "__main__":
    print(f"Starting shopping list organizer on http://localhost:{PORT}")
    try:
        with socketserver.ThreadingTCPServer(("", PORT), ShopHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")
        sys.exit(0)
