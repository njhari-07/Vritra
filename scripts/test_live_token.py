import httpx

r = httpx.get("http://127.0.0.1:8765/api/cases", headers={"Authorization": "Bearer abc"}, timeout=10.0)
print("API Status with 'abc':", r.status_code)
print("Response JSON:", r.json())
