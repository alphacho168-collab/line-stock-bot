#!/bin/bash
export LINETOKEN="Dl3Gi9yzJDNr9ub5n1MTcTyiL/H2Djaj7wVOuWnWy1BJjHfM+dCeXy+dZsQKR9edwVwpfptiPS6jqPwpX9BT79yGL+qDpgIU4x9rHHXUt7r0t8uI2RVDur8/3sxMTQOep1yOs3XmRADGFjTHccJnWwdB04t89/1O/w1cDnyilFU="
export LINE_CHANNEL_ACCESS_TOKEN="$LINETOKEN"
export LIFF_ID="2011732532-ULwmjHGL"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
bash deploy-richmenu.sh
