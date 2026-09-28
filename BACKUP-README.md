# ☁️ GitHub Actions Backup Setup

## ขั้นตอนการตั้งค่า

### 1. สร้าง GitHub Repository
1. เข้า [https://github.com/new](https://github.com/new)
2. สร้าง repo ชื่อ `line-stock-bot` (Private)
3. **อย่าเพิ่ม README** (มีไฟล์อยู่แล้ว)

### 2. Push Code ขึ้น GitHub
```bash
cd "D:\สำหรับรับงานลูกค้า\Line Stock Greenleaf"
git init
git add .
git commit -m "LINE Stock Bot + Backup System"
git remote add origin https://github.com/<YOUR_USERNAME>/line-stock-bot.git
git push -u origin main
```

### 3. เพิ่ม Secrets ใน GitHub
1. เข้า repo → **Settings** → **Secrets and variables** → **Actions**
2. กด **New repository secret** → เพิ่ม 2 ตัว:

| Name | Value | หาจากไหน |
|------|-------|----------|
| `CF_API_TOKEN` | API Token ของคุณ | [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) |
| `CF_ACCOUNT_ID` | Account ID ของคุณ | [Cloudflare Dashboard](https://dash.cloudflare.com) → หน้าแรก |

**หา CF Account ID ได้ที่:**
- [https://dash.cloudflare.com](https://dash.cloudflare.com) → หน้าแรก → จะมี Account ID แสดงอยู่
- หรือจาก URL: `https://dash.cloudflare.com/<ACCOUNT_ID>/home`

**สร้าง CF_API Token:**
1. เข้า [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. กด **Create Token**
3. เลือก template: **Edit zone resources**
4. เพิ่มสิทธิ์: **D1 → Read**
5. ติ๊ก Account resources → เลือกบัญชีของคุณ
6. กด **Continue to summary** → **Create Token**
7. คัดลอก Token → วางใน GitHub Secret

### 4. ตรวจสอบ
- เข้าแท็บ **Actions** ใน GitHub repo
- จะเหี๊ยว `Daily D1 Backup` กำลังรัน
- ถ้าสำเร็จ → ✅ Backup จะถูกสร้างขึ้นทุกวันเวลาตี 3

---

## Backup จะเก็บที่ไหน?
- ไฟล์ `.sql` จะถูกอัปโหลดเป็น **Artifact** ใน GitHub Actions
- เก็บได้ 90 วัน (ฟรี)
- สามารถดาวน์โหลดได้จากแท็บ **Actions** → **Daily D1 Backup** → **Artifacts**

---

## ยกเลิก
- ไปที่ **Settings** → **Actions** → **General** → ปิด **All Actions**
- หรือลบไฟล์ `.github/workflows/backup.yml`
