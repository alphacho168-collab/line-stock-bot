import json, urllib.request, urllib.error

token = "Dl3Gi9yzJDNr9ub5n1MTcTyiL/H2Djaj7wVOuWnWy1BJjHfM+dCeXy+dZsQKR9edwVwpfptiPS6jqPwpX9BT79yGL+qDpgIU4x9rHHXUt7r0t8uI2RVDur8/3sxMTQOep1yOs3XmRADGFjTHccJnWwdB04t89/1O/w1cDnyilFU="
liffId = "2011732532-ULwmjHGL"

# Read and patch richmenu.json
with open("D:/สำหรับรับงานลูกค้า/Line Stock Greenleaf/line-stock-bot/richmenu/richmenu.json") as f:
    data = json.load(f)
data["areas"][0]["action"]["uri"] = data["areas"][0]["action"]["uri"].replace("__LIFF_ID__", liffId)

# Create richmenu
req = urllib.request.Request("https://api.line.me/v2/bot/richmenu", data=json.dumps(data).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())
newId = result["richMenuId"]
print(f"Rich Menu ID: {newId}")

# Upload image
with open("D:/สำหรับรับงานลูกค้า/Line Stock Greenleaf/line-stock-bot/richmenu/richmenu.png", "rb") as f:
    img_data = f.read()
req = urllib.request.Request(f"https://api-data.line.me/v2/bot/richmenu/{newId}/content", data=img_data, headers={"Authorization": f"Bearer {token}", "Content-Type": "image/png"}, method="POST")
urllib.request.urlopen(req)
print("Image uploaded!")

# Set as default
req = urllib.request.Request(f"https://api.line.me/v2/bot/user/all/richmenu/{newId}", data=b"", headers={"Authorization": f"Bearer {token}"}, method="POST")
urllib.request.urlopen(req)
print("Set as default!")

# Delete old richmenus
req = urllib.request.Request("https://api.line.me/v2/bot/richmenu/list", headers={"Authorization": f"Bearer {token}"})
resp = urllib.request.urlopen(req)
menus = json.loads(resp.read())["richmenus"]
for m in menus:
    if m["richMenuId"] != newId:
        req = urllib.request.Request(f"https://api.line.me/v2/bot/richmenu/{m['richMenuId']}", headers={"Authorization": f"Bearer {token}"}, method="DELETE")
        urllib.request.urlopen(req)
        print(f"Deleted old: {m['richMenuId']}")

print("✅ Rich menu installed!")
