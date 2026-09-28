#!/bin/bash
FILE="/d/สำหรับรับงานลูกค้า/Line Stock Greenleaf/line-stock-bot/public/app.js"
# Find the edit block and add del handler after it
sed -i '/const edit = e\.target\.closest.*data-edit-product/,/return api.*products.*then.*openProductForm/{
/return api.*products.*then.*openProductForm/a\
\
const del = e.target.closest("[data-del-product]");\
if (del) {\
    const id = Number(del.dataset.delProduct);\
    if (!confirm("ต้องการลบสินค้านี้ออกจากระบบหรือไม่? ประวัติเดิมจะยังอยู่")) return;\
    api(`/products/${id}`, { method: "DELETE" }).then(() => {\
        toast("ลบสินค้าแล้ว", "ok");\
        closeSheet();\
        refreshAll();\
    }).catch((err) => toast(err.message, "error"));\
}
}' "$FILE"
echo "Done"
