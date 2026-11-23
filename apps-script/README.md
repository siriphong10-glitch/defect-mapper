# ตั้งค่าที่เก็บข้อมูลกลางบน Google Drive

ทำครั้งเดียว โดยใช้บัญชี Google ที่จะเป็นเจ้าของข้อมูล (แนะนำบัญชีทีม เช่น performaxteam@gmail.com)

1. เข้า https://script.google.com แล้วกด **New project** ตั้งชื่อโปรเจกต์ว่า `Inspect Recorder Backend`
2. ลบโค้ดเดิมในไฟล์ `Code.gs` ทั้งหมด แล้ววางโค้ดจากไฟล์ [`Code.gs`](Code.gs) นี้แทน
3. แก้บรรทัด `const EDIT_KEY = 'เปลี่ยนรหัสตรงนี้';` เป็นรหัสแก้ไขของทีม แล้วกดบันทึก (ไอคอนแผ่นดิสก์)
4. ที่แถบด้านบน เลือกฟังก์ชัน **setup** แล้วกด **Run**
   - Google จะขออนุญาตเข้าถึง Drive ให้กด Review permissions → เลือกบัญชี → Advanced → Go to Inspect Recorder Backend (unsafe) → Allow
     (ขึ้นคำว่า unsafe เพราะเป็นสคริปต์ที่เราเขียนเอง ไม่ได้ผ่านการรีวิวของ Google)
   - ระบบจะสร้างโฟลเดอร์ `DefectMapper-Data` ใน Drive
5. กด **Deploy → New deployment** → ไอคอนเฟือง เลือก **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด Deploy แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)
6. นำ URL ไปใส่ใน `js/config.js` (ค่า `SCRIPT_URL`) แล้ว push ขึ้น GitHub

## หมายเหตุ
- ทุกคนที่มีลิงก์เว็บอ่านข้อมูลและรูปได้ การแก้ไข/ลบต้องใช้รหัส `EDIT_KEY`
- เปลี่ยนรหัส: แก้ `EDIT_KEY` แล้วกด Run `setup` อีกครั้ง (ไม่ต้อง deploy ใหม่) ทุกคนต้องใส่รหัสใหม่
- ถ้าแก้โค้ดใน `Code.gs` ต้อง Deploy → Manage deployments → แก้ไข (ไอคอนดินสอ) → Version: New version → Deploy เพื่อให้ URL เดิมใช้โค้ดใหม่
- ข้อมูลอยู่ในโฟลเดอร์ `DefectMapper-Data` (ไฟล์ `index.json`, โฟลเดอร์ `projects/` และ `blobs/`) ห้ามแก้หรือย้ายไฟล์ในโฟลเดอร์นี้ด้วยมือ
