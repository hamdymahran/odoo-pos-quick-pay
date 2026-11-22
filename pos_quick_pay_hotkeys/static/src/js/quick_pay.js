/** @odoo-module */
/*
 * POS Quick Pay Hotkeys — Odoo 20
 * Author: Hamdy Mahran
 *
 *   F10  -> pay the full amount in CASH, print the receipt, start a new order
 *   F12  -> pay the full amount by CARD (شبكة / مدى), print, start a new order
 *
 * Built on Odoo's native "fast payment" validation (OrderPaymentValidation).
 */

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { onMounted, onWillUnmount } from "@odoo/owl";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import OrderPaymentValidation from "@point_of_sale/app/utils/order_payment_validation";
import { FeedbackScreen } from "@point_of_sale/app/screens/feedback_screen/feedback_screen";

// غيّر المفاتيح هنا إن أردت
export const HOTKEYS = { F10: "cash", F12: "card" };
const KEYCODES = { 121: "F10", 123: "F12" };
const CARD_NAME_RE = /شبك|مدى|mada|card|بطاق|visa|master|network|span|بنك|bank|pos/i;
const BUSY_STATUSES = ["pending", "waiting", "waitingCard", "waitingCapture", "waitingCancel", "reversing"];

let busy = false;

function hotkeyKind(ev) {
    const key = ev.key && /^F\d+$/.test(ev.key) ? ev.key : KEYCODES[ev.keyCode];
    return HOTKEYS[key];
}

function dialogOpen() {
    return [...document.querySelectorAll(".modal-dialog, .o_dialog")].some(
        (el) => el.getClientRects().length > 0
    );
}

const isCash = (m) => m.type === "cash" || m.is_cash_count === true;
const isTerminal = (m) => Boolean(m.use_payment_terminal || m.payment_provider || m.payment_interface);
const isQr = (m) => /qr/.test(m.payment_method_type || "");

export function pickMethod(methods, kind) {
    const usable = methods.filter((m) => m.type !== "pay_later" && !isQr(m));
    if (kind === "cash") {
        return usable.find(isCash) || null;
    }
    const card = usable.filter((m) => !isCash(m));
    return card.find((m) => CARD_NAME_RE.test(m.name || "")) || card[0] || null;
}

function configMethods(pos) {
    const methods = pos.config.paymentMethods || pos.config.payment_method_ids || [];
    return [...methods].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
}

function showError(pos, message) {
    (pos.dialog || pos.env.services.dialog).add(AlertDialog, { title: _t("Quick Pay"), body: message });
}

async function quickPay(pos, kind) {
    const order = pos.getOrder();
    if (!order || !order.lines.length || (order.canPay && !order.canPay())) {
        return;
    }
    const method = pickMethod(configMethods(pos), kind);
    if (!method) {
        return showError(
            pos,
            kind === "cash"
                ? _t("No cash payment method in this point of sale. / لا توجد طريقة دفع نقدية في نقطة البيع.")
                : _t("No card payment method in this point of sale. / لا توجد طريقة دفع شبكة في نقطة البيع.")
        );
    }
    if (order.payment_ids.some((l) => BUSY_STATUSES.includes(l.payment_status))) {
        return showError(pos, _t("An electronic payment is in progress. / توجد عملية دفع إلكتروني قيد التنفيذ."));
    }
    if (isTerminal(method)) {
        // جهاز دفع مربوط: افتح شاشة الدفع ليكمل الكاشير العملية مع الجهاز
        return pos.pay();
    }
    for (const line of [...order.payment_ids]) {
        order.removePaymentline(line);
    }
    order._qpQuickPay = true;
    busy = true;
    try {
        const validation = new OrderPaymentValidation({
            pos,
            orderUuid: order.uuid,
            fastPaymentMethod: method,
        });
        validation.qpQuickPay = true;
        await validation.validateOrder(false);
    } finally {
        busy = false;
    }
}

function useQuickPayKeys(component) {
    const handler = (ev) => {
        const kind = hotkeyKind(ev);
        if (!kind) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.repeat || busy || component.isValidatingOrder || dialogOpen()) {
            return;
        }
        quickPay(component.pos, kind);
    };
    onMounted(() => window.addEventListener("keydown", handler, true));
    onWillUnmount(() => window.removeEventListener("keydown", handler, true));
}

patch(ProductScreen.prototype, {
    setup() {
        super.setup(...arguments);
        useQuickPayKeys(this);
    },
});

patch(PaymentScreen.prototype, {
    setup() {
        super.setup(...arguments);
        useQuickPayKeys(this);
    },
});

// طباعة مباشرة ثم طلب جديد بدون المرور بشاشة الإيصال
patch(OrderPaymentValidation.prototype, {
    get canPrintReceipt() {
        if (this.qpQuickPay) {
            return this.order.nb_print === 0 && (this.order.isToInvoice() ? this.order.finalized : true);
        }
        return super.canPrintReceipt;
    },
    get nextPage() {
        const next = super.nextPage;
        if (this.qpQuickPay && next && next.page === "ReceiptScreen") {
            return { page: "FeedbackScreen", params: { orderUuid: this.order.uuid } };
        }
        return next;
    },
});

// شاشة "تم الدفع" تختفي تلقائياً وتفتح طلباً جديداً
patch(FeedbackScreen.prototype, {
    get isAutoSkip() {
        if (this.currentOrder?._qpQuickPay) {
            return true;
        }
        return super.isAutoSkip;
    },
});
