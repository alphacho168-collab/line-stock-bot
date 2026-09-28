$token = 'Dl3Gi9yzJDNr9ub5n1MTcTyiL/H2Djaj7wVOuWnWy1BJjHfM+dCeXy+dZsQKR9edwVwpfptiPS6jqPwpX9BT79yGL+qDpgIU4x9rHHXUt7r0t8uI2RVDur8/3sxMTQOep1yOs3XmRADGFjTHccJnWwdB04t89/1O/w1cDnyilFU='
$liffId = '2011732532-ULwmjHGL'
$json = Get-Content 'D:\สำหรับรับงานลูกค้า\Line Stock Greenleaf\line-stock-bot\richmenu\richmenu.json' -Raw
$json = $json -replace '__LIFF_ID__', $liffId
$h = @{ authorization = "Bearer $token"; 'content-type' = 'application/json' }
$resp = curl.exe -s -X POST https://api.line.me/v2/bot/richmenu -H $h -d $json
$result = $resp | ConvertFrom-Json
$newId = $result.richMenuId
Write-Host "Rich Menu ID: $newId"
curl.exe -s -X POST "https://api-data.line.me/v2/bot/richmenu/$newId/content" -H $h --data-binary '@D:\สำหรับรับงานลูกค้า\Line Stock Greenleaf\line-stock-bot\richmenu\richmenu.png' | Out-Null
Write-Host "Image uploaded!"
curl.exe -s -X POST "https://api.line.me/v2/bot/user/all/richmenu/$newId" -H $h -H @{ 'content-length' = '0' } | Out-Null
Write-Host "Set as default!"
curl.exe -s https://api.line.me/v2/bot/richmenu/list -H $h | ForEach-Object { ($_ | ConvertFrom-Json).richmenus | ForEach-Object { if ($_.richMenuId -ne $newId) { curl.exe -s -X DELETE "https://api.line.me/v2/bot/richmenu/$($_.richMenuId)" -H $h; Write-Host "Deleted: $($_.richMenuId)" } } }
Write-Host "✅ Rich menu installed!"
