SELECT id, name, sku, active,
       CASE WHEN photo IS NULL THEN 0 ELSE 1 END AS has_photo,
       length(photo) AS photo_len
FROM products
ORDER BY id;
