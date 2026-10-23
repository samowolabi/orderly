#!/bin/bash
# Curl tests for the Orderly API against dev/fake-paystack.ts.
# Needs: the database in .env, npm run fake-paystack, and the API started with
#   PAYSTACK_BASE_URL=http://localhost:4010 npm run dev
# Reseeds nothing; run npm run db:seed first for a clean slate.
# Usage: npm run test:api
cd "$(dirname "$0")/.." || exit 1
API=${API:-http://localhost:3000}
FAKE=${FAKE:-http://localhost:4010}
BUYER=$(grep '^BUYER_API_KEY=' .env | cut -d= -f2)
SELLER=$(grep '^SELLER_API_KEY=' .env | cut -d= -f2)
PAYSTACK_SECRET_KEY=$(grep '^PAYSTACK_SECRET_KEY=' .env | cut -d= -f2-)
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-)
PSQL="$(command -v psql || echo /Library/PostgreSQL/18/bin/psql) $DATABASE_URL -X -qtA"
PASS=0; FAILS=0
RACE_FILE=$(mktemp -t orderly-race)
trap 'rm -f "$RACE_FILE"' EXIT

# Sends an API request and stores its response status and body.
call() {
  local key=$1 method=$2 path=$3 data=$4 hdr=()
  [ "$key" != none ] && hdr=(-H "X-Api-Key: $key")
  local out
  out=$(curl -s -w $'\n%{http_code}' -X "$method" "${hdr[@]}" -H 'content-type: application/json' ${data:+-d "$data"} "$API$path")
  STATUS=${out##*$'\n'}; BODY=${out%$'\n'*}
}
# Signs and sends a Paystack webhook request.
webhook() {
  local data=$1 signature=${2:-}
  [ -z "$signature" ] && signature=$(printf '%s' "$data" | openssl dgst -sha512 -hmac "$PAYSTACK_SECRET_KEY" -hex | awk '{print $NF}')
  local out
  out=$(curl -s -w $'\n%{http_code}' -X POST -H 'content-type: application/json' \
    -H "x-paystack-signature: $signature" -d "$data" "$API/webhooks/paystack")
  STATUS=${out##*$'\n'}; BODY=${out%$'\n'*}
}
# Checks the last API response against an HTTP status and jq assertion.
check() {
  local name=$1 want=$2 expr=${3:-true}
  if [ "$STATUS" = "$want" ] && [ "$(jq -r "$expr" <<<"$BODY" 2>/dev/null)" = "true" ]; then
    PASS=$((PASS+1)); printf '  ok    %s\n' "$name"
  else
    FAILS=$((FAILS+1)); printf '  FAIL  %s (HTTP %s, wanted %s)\n        %s\n' "$name" "$STATUS" "$want" "$(head -c 400 <<<"$BODY")"
  fi
}
# Prints agent guidance from the last API response.
msg() { jq -r '.error.message_for_agent // .data.next_step // empty' <<<"$BODY" | sed 's/^/        > /'; }
# Marks the newest fake transaction for an order with the requested outcome.
pay() {
  local data=${2:-'{"outcome":"success"}'}
  # $1 is an order id; pays its newest Paystack reference
  local ref; ref=$(ref "$1")
  curl -sf -X POST -H 'content-type: application/json' -d "$data" "$FAKE/_fake/pay/$ref" >/dev/null || echo "        (fake pay $1/$ref failed)"
}
# Changes fake Paystack's initialize or verify failure mode.
mode() { curl -s -X POST -H 'content-type: application/json' -d "$1" "$FAKE/_fake/mode" >/dev/null; }
# Reads an order's newest payment reference from Postgres.
ref() { $PSQL -c "SELECT payment_references[cardinality(payment_references)] FROM orders WHERE id='$1'"; }
# Reads an order's total amount in kobo from Postgres.
amount() { $PSQL -c "SELECT amount_kobo FROM orders WHERE id='$1'"; }
# Counts matching event-log rows for an order.
event_count() { $PSQL -c "SELECT count(*) FROM events WHERE order_id='$1' AND type='$2'"; }
# Reads available stock for a product at one store.
stock() { $PSQL -c "SELECT available FROM stock WHERE product_id='$1' AND store_id='$2'"; }
# Moves an order's expiry timestamp into the past for late-payment tests.
expire() { $PSQL -c "UPDATE orders SET expires_at = now() - interval '1 second' WHERE id='$1'"; }

echo "== Auth and roles"
call none GET /stores;                         check "no key is refused" 401 '.ok == false and .error.code == "unauthorized"'
call wrong-key-0000000000 GET /stores;         check "wrong key is refused" 401
call "$BUYER" PATCH /products/IP13-128 '{"price_naira":1}'; check "buyer can't change a price" 403 '.error.code == "owner_only"'; msg
call "$BUYER" POST /stores '{"name":"Hack","address":{"line1":"1 Fake Road","area":"Ikeja","city":"Lagos","state":"Lagos"},"hours":[{"days":["mon","tue","wed","thu","fri"],"opens":"08:30","closes":"18:00"},{"days":["sat"],"opens":"10:00","closes":"16:00"}]}'; check "buyer can't add a store" 403
call "$BUYER" GET /orders;                     check "buyer can't list orders" 403
call "$SELLER" POST /orders '{"product_id":"IP13-128","store_id":"ikeja","buyer_name":"x"}'; check "seller can't create orders (buyer tool)" 403

echo "== Catalog reads"
call "$BUYER" GET /stores;                     check "list_stores" 200 '.data.stores | length == 2'
check "Ikeja hours text" 200 '.data.stores[0].opening_hours == "Mon to Sat, 9am to 7pm; Sun, closed"'
check "Lekki hours text" 200 '.data.stores[1].opening_hours == "Mon to Sat, 10am to 8pm; Sun, 12pm to 5pm"'
check "structured hours and open_now" 200 '(.data.stores[0].hours | length == 6) and .data.stores[0].hours[0] == {"day":"Monday","opens":"09:00","closes":"19:00"} and (.data.stores | all(.open_now | type == "boolean"))'
check "structured addresses and map pins" 200 '.data.stores[0].address_details == {"line1":"14 Allen Avenue","line2":null,"area":"Ikeja","city":"Lagos","state":"Lagos","country_code":"NG","postal_code":null,"directions_note":null} and .data.stores[0].location.latitude == 6.604718 and (.data.stores[0].location.map_url | contains("6.604718"))'
call "$BUYER" GET '/products?q=iphone%2013';   check "search 'iphone 13' finds IP13-128 only" 200 '[.data.products[].id] == ["IP13-128"]'
check "buyer doesn't see the discount floor" 200 '.data.products[0] | has("min_price_naira") | not'
check "price shown in naira" 200 '.data.products[0].price_naira == 650000 and .data.products[0].price_display == "₦650,000"'
call "$SELLER" GET '/products?q=iphone%2013';  check "seller sees the discount floor" 200 '.data.products[0].min_price_naira == 620000'
call "$BUYER" GET '/products?store_id=lekki';  check "filter by store" 200 '[.data.products[].stores[].store_id] | unique == ["lekki"]'
call "$BUYER" GET '/products?store_id=abuja';  check "unknown store filter" 404 '.error.code == "store_not_found"'
call "$BUYER" GET '/products?q=100%25';        check "LIKE wildcards are escaped" 200 '.data.products | length == 0'

echo "== Owner: add_store"
call "$SELLER" POST /stores '{"name":"Kola Gadgets Yaba","address":{"line1":"3 Herbert Macaulay Way","area":"Yaba","city":"Lagos","state":"Lagos"},"location":null,"hours":[{"days":["mon","tue","wed","thu","fri"],"opens":"08:30","closes":"18:00"},{"days":["sat"],"opens":"10:00","closes":"16:00"}]}'
check "add Yaba (id made from name)" 201 '.data.id == "yaba" and .data.address == "3 Herbert Macaulay Way, Yaba, Lagos" and .data.address_details.country_code == "NG" and .data.location.latitude == null and (.data.location.map_url | contains("Herbert%20Macaulay")) and .data.opening_hours == "Mon to Fri, 8:30am to 6pm; Sat, 10am to 4pm; Sun, closed"'
for bad in '[]' '[{"days":["mon"],"opens":"9am","closes":"17:00"}]' '[{"days":["mon"],"opens":"18:00","closes":"09:00"}]' \
           '[{"days":["mon","tue"],"opens":"09:00","closes":"17:00"},{"days":["tue"],"opens":"10:00","closes":"12:00"}]' \
           '[{"days":["monday"],"opens":"09:00","closes":"17:00"}]'; do
  call "$SELLER" POST /stores '{"name":"Kola Gadgets Ajah","address":{"line1":"1 Ajah Road","area":"Ajah","city":"Lagos","state":"Lagos"},"hours":'"$bad"'}'
  check "bad hours refused: $bad" 400 '.error.code == "invalid_input"'
done
msg
call "$SELLER" POST /stores '{"name":"Kola Gadgets Yaba","address":{"line1":"3 Herbert Macaulay Way","area":"Yaba","city":"Lagos","state":"Lagos"},"location":null,"hours":[{"days":["mon","tue","wed","thu","fri"],"opens":"08:30","closes":"18:00"},{"days":["sat"],"opens":"10:00","closes":"16:00"}]}'
check "duplicate store" 409 '.error.code == "store_exists"'
call "$SELLER" POST /stores '{"name":"Surulere"}'; check "missing fields named" 400 '.error.message_for_agent | test("address is required") and test("hours is required")'; msg
call "$BUYER" GET '/products?product_id=IP13-128'; check "new store has 0 stock lines" 200 '[.data.products[0].stores[] | select(.store_id=="yaba") | .available] == [0]'

echo "== Owner: update_store"
call "$BUYER" PATCH /stores/yaba '{"name":"Hacked"}';  check "buyer can't update a store" 403 '.error.code == "owner_only"'
call "$SELLER" PATCH /stores/yaba '{}';                 check "empty update refused" 400 '.error.message_for_agent | test("at least one")'; msg
call "$SELLER" PATCH /stores/abuja '{"name":"Kola Gadgets Abuja"}'; check "unknown store" 404 '.error.code == "store_not_found"'
call "$SELLER" PATCH /stores/yaba '{"hours":[{"days":["sat"],"opens":"09:00","closes":"17:00"}]}'
check "change Saturday only" 200 '.data.store.opening_hours == "Mon to Fri, 8:30am to 6pm; Sat, 9am to 5pm; Sun, closed" and .data.previous.opening_hours == "Mon to Fri, 8:30am to 6pm; Sat, 10am to 4pm; Sun, closed"'
call "$SELLER" PATCH /stores/YABA '{"hours":[{"days":["sun"],"opens":"12:00","closes":"16:00"}],"closed_days":["mon"]}'
check "open Sunday, close Monday (id is case-insensitive)" 200 '.data.store.opening_hours == "Mon, closed; Tue to Fri, 8:30am to 6pm; Sat, 9am to 5pm; Sun, 12pm to 4pm"'
call "$SELLER" PATCH /stores/yaba '{"hours":[{"days":["mon"],"opens":"09:00","closes":"17:00"}],"closed_days":["mon"]}'
check "same day in hours and closed_days" 400 '.error.message_for_agent | test("both")'
call "$SELLER" PATCH /stores/yaba '{"hours":[{"days":["tue"],"opens":"17:00","closes":"09:00"}]}'; check "closes before opens" 400
call "$SELLER" PATCH /stores/yaba '{"closed_days":["funday"]}'; check "unknown day" 400
call "$SELLER" PATCH /stores/yaba '{"location":{"latitude":91,"longitude":3.4}}'; check "bad latitude" 400
call "$SELLER" PATCH /stores/yaba '{"name":"Kola Gadgets Yaba Hub","address":{"line1":"5 Herbert Macaulay Way","directions_note":"Opposite the bus stop"},"location":{"latitude":6.5095,"longitude":3.3711}}'
check "rename, move and pin, hours kept" 200 '.data.store.name == "Kola Gadgets Yaba Hub" and .data.previous.name == "Kola Gadgets Yaba" and .data.store.address == "5 Herbert Macaulay Way, Yaba, Lagos" and .data.store.address_details.directions_note == "Opposite the bus stop" and .data.store.location.latitude == 6.5095 and .data.store.opening_hours == .data.previous.opening_hours'
call "$BUYER" GET /stores;                              check "list_stores shows the update" 200 '[.data.stores[] | select(.id=="yaba") | .name, .address, .location.longitude] == ["Kola Gadgets Yaba Hub","5 Herbert Macaulay Way, Yaba, Lagos",3.3711]'
[ "$($PSQL -c "SELECT count(*) FROM events WHERE type='store_updated'")" = 3 ] && { PASS=$((PASS+1)); echo "  ok    each update is logged"; } || { FAILS=$((FAILS+1)); echo "  FAIL  store_updated events: $($PSQL -c "SELECT count(*) FROM events WHERE type='store_updated'")"; }

echo "== Owner: add_product"
call "$SELLER" POST /products '{"name":"iPhone 16","variant":"256GB","price_naira":1150000,"stock":[{"store_id":"ikeja","quantity":2},{"store_id":"lekki","quantity":1}]}'
check "add iPhone 16 256GB" 201 '.data.id == "IPHONE-16-256GB" and .data.total_available == 3 and .data.min_price_naira == 1150000'
call "$SELLER" POST /products '{"name":"iphone 16","variant":"256gb","price_naira":1}'; check "duplicate by name and variant" 409 '.error.code == "product_exists"'; msg
call "$SELLER" POST /products '{"name":"Pixel 9","price_naira":900000,"stock":[{"store_id":"abuja","quantity":1}]}'; check "unknown store in stock" 404 '.error.code == "store_not_found"'
call "$SELLER" POST /products '{"name":"Pixel 9","price_naira":900000,"min_price_naira":950000}'; check "floor above price" 400 '.error.code == "invalid_input"'
call "$SELLER" POST /products '{"name":"Pixel 9","price_naira":-5}'; check "negative price" 400
call "$SELLER" POST /products '{bad json'; check "bad JSON" 400 '.error.code == "bad_json"'

echo "== Owner: update_stock and update_price"
call "$SELLER" POST /products/IPHONE-16-256GB/stock '{"store_id":"lekki","change":3}'; check "add 3 more to Lekki" 200 '.data.available == 4'
call "$SELLER" POST /products/IPHONE-16-256GB/stock '{"store_id":"lekki","change":-10}'; check "can't go below zero" 409 '.error.code == "stock_below_zero"'; msg
call "$SELLER" POST /products/IPHONE-16-256GB/stock '{"store_id":"lekki","change":1,"set_to":3}'; check "change and set_to together" 400
call "$SELLER" POST /products/IPHONE-16-256GB/stock '{"store_id":"lekki","set_to":2}'; check "set_to after a count" 200 '.data.available == 2 and .data.on_hand == 2'
call "$SELLER" POST /products/NOPE/stock '{"store_id":"lekki","change":1}'; check "unknown product" 404
call "$SELLER" PATCH /products/IP13-128 '{"price_naira":630000}'; check "update price" 200 '.data.old_price_naira == 650000 and .data.product.price_naira == 630000'
call "$SELLER" PATCH /products/IP13-128 '{"price_naira":600000}'; check "price below floor lowers the floor" 200 '.data.product.min_price_naira == 600000'
call "$SELLER" PATCH /products/IP13-128 '{"price_naira":650000,"min_price_naira":620000}'; check "restore price and floor" 200 '.data.product.price_naira == 650000'

echo "== Happy path: order, 'I paid' too early, pay, verify, receipt"
before=$(stock IP13-128 ikeja)
call "$BUYER" POST /orders '{"product_id":"ip13-128","store_id":"Ikeja","buyer_name":"Tunde Bakare"}'
check "create_order" 201 '.data.status == "pending_payment" and (.data.payment_url | startswith("http")) and .data.minutes_left == 30 and .data.amount_naira == 650000'
O1=$(jq -r .data.order_id <<<"$BODY"); echo "        order $O1"
[ "$(stock IP13-128 ikeja)" = "$((before-1))" ] && { PASS=$((PASS+1)); echo "  ok    stock held ($before -> $((before-1)))"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock not held"; }
call "$BUYER" GET "/orders/$O1/receipt";      check "no receipt before payment" 409 '.error.code == "not_paid"'
call "$BUYER" POST "/orders/$O1/verify";      check "'I've paid' before paying" 200 '.data.outcome == "not_paid_yet" and .data.receipt == null and (.data.order.payment_url | length > 0)'; msg
pay "$O1" '{"outcome":"ongoing"}'
call "$BUYER" POST "/orders/$O1/verify";      check "payment still processing" 200 '.data.outcome == "payment_processing"'
pay "$O1"
call "$BUYER" POST "/orders/$O1/verify";      check "verify after paying" 200 '.data.outcome == "paid" and .data.order.status == "paid" and .data.receipt.total_naira == 650000'
jq -r .data.receipt.text <<<"$BODY" | sed 's/^/        | /'
call "$BUYER" POST "/orders/$O1/verify";      check "verify again is idempotent" 200 '.data.outcome == "already_paid"'
call "$SELLER" GET "/orders/$O1/receipt";     check "owner can get the receipt" 200 '.data.receipt_number == "'"$O1"'"'
[ "$(stock IP13-128 ikeja)" = "$((before-1))" ] && { PASS=$((PASS+1)); echo "  ok    stock stays sold after payment"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock changed after payment"; }

echo "== Bad order input"
call "$BUYER" POST /orders '{"product_id":"IP13-128","store_id":"ikeja"}'; check "missing buyer_name" 400 '.error.message_for_agent | test("buyer_name is required")'; msg
call "$BUYER" POST /orders '{"product_id":"IP13-128","store_id":"ikeja","buyer_name":"A","quantity":0}'; check "quantity 0" 400
call "$BUYER" POST /orders '{"product_id":"NOPE","store_id":"ikeja","buyer_name":"A"}'; check "unknown product" 404 '.error.code == "product_not_found"'
call "$BUYER" POST /orders '{"product_id":"AIRPODS-PRO2","store_id":"ikeja","buyer_name":"A"}'; check "out of stock here, offers Lekki" 409 '.error.code == "out_of_stock" and (.error.message_for_agent | test("Lekki"))'; msg
call "$BUYER" POST /orders '{"product_id":"IP13-128","store_id":"lekki","buyer_name":"A","quantity":5}'; check "not enough units" 409 '.error.code == "out_of_stock"'
call "$BUYER" POST /orders/ORD-9999/verify;   check "unknown order" 404 '.error.code == "order_not_found"'

echo "== Never sell twice: two buyers, last unit, at the same moment"
for who in Ada Bola; do
  curl -s -o "/tmp/claude-501/race-$who.json" -w '%{http_code}\n' -X POST -H "X-Api-Key: $BUYER" -H 'content-type: application/json' \
    -d "{\"product_id\":\"IP15P-256\",\"store_id\":\"ikeja\",\"buyer_name\":\"$who\"}" "$API/orders" &
done > /tmp/claude-501/race-codes.txt; wait
codes=$(sort /tmp/claude-501/race-codes.txt | tr '\n' ' ')
[ "$codes" = "201 409 " ] && { PASS=$((PASS+1)); echo "  ok    one 201, one 409 ($codes)"; } || { FAILS=$((FAILS+1)); echo "  FAIL  race codes: $codes"; }
[ "$(stock IP15P-256 ikeja)" = "0" ] && { PASS=$((PASS+1)); echo "  ok    stock is 0, not negative"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock: $(stock IP15P-256 ikeja)"; }
RACE=$(jq -r 'select(.ok) | .data.order_id' /tmp/claude-501/race-*.json)
jq -r 'select(.ok|not) | .error.message_for_agent' /tmp/claude-501/race-*.json | sed 's/^/        > /'

echo "== Late payment, item gone: paid_no_stock"
expire "$RACE"
call "$BUYER" GET '/products?product_id=IP15P-256'; check "expired hold returns the unit" 200 '.data.products[0].total_available == 1'
call "$BUYER" POST "/orders/$RACE/verify";    check "verify after expiry, unpaid" 200 '.data.outcome == "expired"'; msg
call "$BUYER" POST /orders '{"product_id":"IP15P-256","store_id":"ikeja","buyer_name":"Chika"}'; check "someone else takes the unit" 201
pay "$RACE"
call "$BUYER" POST "/orders/$RACE/verify";    check "late payer gets paid_no_stock" 200 '.data.outcome == "paid_no_stock" and .data.receipt == null'; msg
[ "$(stock IP15P-256 ikeja)" = "0" ] && { PASS=$((PASS+1)); echo "  ok    still not oversold"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock: $(stock IP15P-256 ikeja)"; }

echo "== Late payment, item still there: re-held"
call "$BUYER" POST /orders '{"product_id":"A15-128","store_id":"lekki","buyer_name":"Dayo"}'; O2=$(jq -r .data.order_id <<<"$BODY")
a15=$(stock A15-128 lekki); expire "$O2"
O2_REF=$(ref "$O2"); O2_AMOUNT=$(amount "$O2")
WEBHOOK=$(jq -nc --arg reference "$O2_REF" --argjson amount "$O2_AMOUNT" \
  '{event:"charge.success",data:{status:"success",reference:$reference,amount:$amount,currency:"NGN",channel:"card",paid_at:"2026-10-22T22:00:00.000Z",gateway_response:"Successful"}}')
webhook "$WEBHOOK" bad;                        check "invalid webhook signature" 401 '.error.code == "invalid_webhook_signature"'
webhook "$WEBHOOK";                            check "webhook expires the hold, then re-holds" 200 '.data.outcome == "paid_late_reheld" and .data.order_id == "'"$O2"'"'
webhook "$WEBHOOK";                            check "repeated webhook is idempotent" 200 '.data.outcome == "already_paid"'
[ "$(event_count "$O2" payment_confirmed)" = 0 ] \
  && [ "$(event_count "$O2" paid_late_reheld)" = 1 ] \
  && { PASS=$((PASS+1)); echo "  ok    webhook logs one payment event"; } \
  || { FAILS=$((FAILS+1)); echo "  FAIL  webhook logged duplicate payment events"; }
call "$BUYER" POST "/orders/$O2/verify";      check "verify sees webhook-confirmed payment" 200 '.data.outcome == "already_paid" and .data.receipt.payment_reference == "'"$O2_REF"'"'
[ "$(stock A15-128 lekki)" = "$a15" ] && { PASS=$((PASS+1)); echo "  ok    unit taken again on late payment"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock: $(stock A15-128 lekki), wanted $a15"; }

echo "== Declined card: new link, then success on the new link"
call "$BUYER" POST /orders '{"product_id":"S23-256","store_id":"lekki","buyer_name":"Emeka"}'; O3=$(jq -r .data.order_id <<<"$BODY"); url1=$(jq -r .data.payment_url <<<"$BODY")
ref1=$(ref "$O3" | tr -d "\n")
pay "$O3" '{"outcome":"failed"}'
call "$BUYER" POST "/orders/$O3/verify";      check "declined gives a new link" 200 '.data.outcome == "declined" and .data.order.status == "pending_payment" and .data.order.payment_url != "'"$url1"'" and .data.order.declined_attempts == 1'; msg
pay "$O3"
call "$BUYER" POST "/orders/$O3/verify";      check "pays on the new link" 200 '.data.outcome == "paid" and (.data.receipt.payment_reference | startswith("'"$O3"'-")) and .data.receipt.payment_reference != "'"$ref1"'"'

echo "== Declined three times: cancelled and released"
s23=$(stock S23-256 ikeja)
call "$BUYER" POST /orders '{"product_id":"S23-256","store_id":"ikeja","buyer_name":"Femi"}'; O4=$(jq -r .data.order_id <<<"$BODY")
pay "$O4" '{"outcome":"failed"}';    call "$BUYER" POST "/orders/$O4/verify"; check "decline 1" 200 '.data.outcome == "declined"'
pay "$O4" '{"outcome":"failed"}'; call "$BUYER" POST "/orders/$O4/verify"; check "decline 2 says hand over" 200 '.data.outcome == "declined" and (.data.next_step | test("hand over"))'; msg
pay "$O4" '{"outcome":"failed"}'; call "$BUYER" POST "/orders/$O4/verify"; check "decline 3 cancels" 200 '.data.outcome == "declined_final" and .data.order.status == "failed"'; msg
[ "$(stock S23-256 ikeja)" = "$s23" ] && { PASS=$((PASS+1)); echo "  ok    unit released"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock: $(stock S23-256 ikeja)"; }

echo "== Amount mismatch: never confirmed"
c20=$(stock CAMON20-256 ikeja)
call "$BUYER" POST /orders '{"product_id":"CAMON20-256","store_id":"ikeja","buyer_name":"Gbenga"}'; O5=$(jq -r .data.order_id <<<"$BODY")
pay "$O5" '{"outcome":"success","amount":100}'
call "$BUYER" POST "/orders/$O5/verify";      check "wrong amount is refused" 409 '.ok == false and .error.code == "amount_mismatch"'; msg
call "$BUYER" GET "/orders/$O5/receipt";      check "no receipt for it" 409
[ "$(stock CAMON20-256 ikeja)" = "$c20" ] && { PASS=$((PASS+1)); echo "  ok    unit released"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock: $(stock CAMON20-256 ikeja)"; }

echo "== Paystack failures"
call "$BUYER" POST /orders '{"product_id":"ANKER-20K","store_id":"ikeja","buyer_name":"Halima"}'; O6=$(jq -r .data.order_id <<<"$BODY")
mode '{"verify":"down"}'
call "$BUYER" POST "/orders/$O6/verify";      check "Paystack down on verify" 503 '.error.code == "paystack_unreachable"'; msg
mode '{"verify":"ok"}'
call "$BUYER" GET "/orders/$O6/receipt";      check "still not confirmed" 409
anker=$(stock ANKER-20K ikeja); mode '{"initialize":"fail"}'
call "$BUYER" POST /orders '{"product_id":"ANKER-20K","store_id":"ikeja","buyer_name":"Ife"}'; check "link creation fails" 502 '.error.code == "payment_link_failed"'; msg
mode '{"initialize":"ok"}'
[ "$(stock ANKER-20K ikeja)" = "$anker" ] && { PASS=$((PASS+1)); echo "  ok    held unit released after link failure"; } || { FAILS=$((FAILS+1)); echo "  FAIL  stock: $(stock ANKER-20K ikeja)"; }

echo "== Owner: list_orders"
call "$SELLER" GET /orders;                   check "today's orders and summary" 200 '.data.period == "today" and .data.summary.counts.paid == 3 and .data.summary.paid_total_naira == 1640000'
jq -c '.data.summary' <<<"$BODY" | sed 's/^/        /'
check "paid_no_stock and mismatch need attention" 200 '[.data.needs_attention[].order_id] | contains(["'"$RACE"'", "'"$O5"'"])'
call "$SELLER" GET '/orders?status=paid&store_id=lekki'; check "filter by status and store" 200 '[.data.orders[] | .status, .store.id] | unique == ["lekki","paid"]'
call "$SELLER" GET '/orders?period=yesterday'; check "bad period" 400

echo
echo "Passed $PASS, failed $FAILS"

echo "== Ten buyers at once, two units (S23-256 at Lekki)"
$PSQL -c "UPDATE stock SET available = 2 WHERE product_id='S23-256' AND store_id='lekki'"
for i in $(seq 1 10); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "X-Api-Key: $BUYER" -H 'content-type: application/json' \
    -d "{\"product_id\":\"S23-256\",\"store_id\":\"lekki\",\"buyer_name\":\"Buyer $i\"}" "$API/orders" &
done > "$RACE_FILE"; wait
won=$(grep -c 201 "$RACE_FILE"); lost=$(grep -c 409 "$RACE_FILE")
[ "$won" = 2 ] && [ "$lost" = 8 ] && [ "$(stock S23-256 lekki)" = 0 ] \
  && { PASS=$((PASS+1)); echo "  ok    2 held, 8 refused, stock 0"; } \
  || { FAILS=$((FAILS+1)); echo "  FAIL  won $won, lost $lost, stock $(stock S23-256 lekki)"; }
echo "Passed $PASS, failed $FAILS"
[ "$FAILS" -eq 0 ]
