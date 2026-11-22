# POS Quick Pay Hotkeys (F10 Cash / F12 Card)

Odoo Point of Sale module: pay the whole order with one key, print the receipt directly and start the next order.

| Key | Action |
|-----|--------|
| **F10** | Pay the full amount in **cash** → validate → print receipt → new order |
| **F12** | Pay the full amount by **card** (bank / mada / Visa) → validate → print receipt → new order |

- Works on the Products screen and the Payment screen.
- Uses Odoo's own order validation (invoice, customer checks, cash drawer, stock).
- Prints automatically only for hotkey orders; your normal print settings are unchanged.
- The card method is the first non-cash method whose name contains Card, Bank, Visa, mada, شبكة or مدى (otherwise the first non-cash method).
- Card methods linked to a payment terminal open the Payment screen so the cashier sends the request to the terminal.
- No configuration needed.

**Silent printing:** use an IoT Box / ePos printer, or start Chrome with `--kiosk-printing`.

## Branches

One branch per Odoo version: `12.0`, `13.0`, `14.0`, `15.0`, `16.0`, `17.0`, `18.0`, `19.0`, `20.0`.

---

## دفع سريع بالكيبورد لنقطة البيع

- **F10**: دفع نقدي بكامل المبلغ + طباعة الإيصال مباشرة + طلب جديد.
- **F12**: دفع شبكة (مدى / فيزا) بكامل المبلغ + طباعة الإيصال مباشرة + طلب جديد.

للطباعة بدون نافذة الطباعة شغّل كروم بخيار `--kiosk-printing` أو استخدم IoT Box.

Author: **Hamdy Mahran** — License: LGPL-3
