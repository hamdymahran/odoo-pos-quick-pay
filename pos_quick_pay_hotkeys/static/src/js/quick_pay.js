/** @odoo-module */
/*
 * POS Quick Pay Hotkeys — Odoo 18
 * Author: Hamdy Mahran
 *
 *   F10  -> pay the full amount in CASH, print the receipt, start a new order
 *   F12  -> pay the full amount by CARD (شبكة / مدى), print, start a new order
 */

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { onMounted, onWillUnmount } from "@odoo/owl";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

// غيّر المفاتيح هنا إن أردت
export const HOTKEYS = { F10: "cash", F12: "card" };
const KEYCODES = { 121: "F10", 123: "F12" };
const CARD_NAME_RE = /شبك|مدى|mada|card|بطاق|visa|master|network|span|بنك|bank|pos/i;

let busy = false;

function hotkeyKind(ev) {
    const key = ev.key && /^F\d+$/.test(ev.key) ? ev.key : KEYCODES[ev.keyCode];
    return HOTKEYS[key];
}

function dialogOpen() {
    return [...document.querySelectorAll(".modal-dialog, .o_dialog, .popup")].some(
        (el) => el.getClientRects().length > 0
    );
}

function isTerminal(m) {
    return Boolean(m.use_payment_terminal || m.payment_terminal);
}

export function pickMethod(methods, kind) {
    const usable = methods.filter((m) => m.type !== "pay_later");
    if (kind === "cash") {
        return usable.find((m) => m.is_cash_count || m.type === "cash") || null;
    }
    const card = usable.filter((m) => !(m.is_cash_count || m.type === "cash"));
    return card.find((m) => CARD_NAME_RE.test(m.name || "")) || card[0] || null;
}

function configMethods(pos) {
    return [...(pos.config.payment_method_ids || [])].sort((a, b) => a.sequence - b.sequence);
}

function showError(env, kind) {
    env.services.dialog.add(AlertDialog, {
        title: _t("Quick Pay"),
        body:
            kind === "cash"
                ? _t("No cash payment method in this point of sale. / لا توجد طريقة دفع نقدية في نقطة البيع.")
                : kind === "card"
                ? _t("No card payment method in this point of sale. / لا توجد طريقة دفع شبكة في نقطة البيع.")
                : _t("An electronic payment is in progress. / توجد عملية دفع إلكتروني قيد التنفيذ."),
    });
}

function useQuickPayKeys(component, onKind) {
    const handler = (ev) => {
        const kind = hotkeyKind(ev);
        if (!kind) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.repeat || busy || dialogOpen()) {
            return;
        }
        onKind(kind);
    };
    onMounted(() => window.addEventListener("keydown", handler, true));
    onWillUnmount(() => window.removeEventListener("keydown", handler, true));
}

// يجبر الطباعة التلقائية وتخطي شاشة الإيصال لهذا الطلب فقط
async function withForcedDirectPrint(config, fn) {
    const saved = [config.iface_print_auto, config.iface_print_skip_screen];
    config.iface_print_auto = true;
    config.iface_print_skip_screen = true;
    try {
        return await fn();
    } finally {
        [config.iface_print_auto, config.iface_print_skip_screen] = saved;
    }
}

patch(ProductScreen.prototype, {
    setup() {
        super.setup(...arguments);
        useQuickPayKeys(this, (kind) => this._qpQuickPay(kind));
    },
    async _qpQuickPay(kind) {
        const order = this.pos.get_order();
        if (!order || !order.get_orderlines().length) {
            return;
        }
        const method = pickMethod(configMethods(this.pos), kind);
        if (!method) {
            return showError(this.env, kind);
        }
        order._qpMethodId = method.id;
        await this.pos.pay();
    },
});

patch(PaymentScreen.prototype, {
    setup() {
        super.setup(...arguments);
        useQuickPayKeys(this, (kind) => {
            const method = pickMethod(this.payment_methods_from_config, kind);
            if (!method) {
                return showError(this.env, kind);
            }
            this._qpPayWith(method);
        });
    },
    onMounted() {
        super.onMounted(...arguments);
        const order = this.currentOrder;
        if (order && order._qpMethodId) {
            const method = this.payment_methods_from_config.find((m) => m.id === order._qpMethodId);
            delete order._qpMethodId;
            if (method) {
                this._qpPayWith(method);
            }
        }
    },
    async _qpPayWith(method) {
        if (busy) {
            return;
        }
        const order = this.currentOrder;
        if (order.electronic_payment_in_progress()) {
            return showError(this.env, "busy");
        }
        for (const line of [...order.payment_ids]) {
            order.remove_paymentline(line);
        }
        // تضيف سطر دفع بكامل المبلغ المستحق
        if (!(await this.addNewPaymentLine(method))) {
            return;
        }
        if (isTerminal(method)) {
            // جهاز دفع مربوط: يكمل الكاشير من شاشة الدفع
            return;
        }
        order._qpQuickPay = true;
        busy = true;
        try {
            await this.validateOrder(false);
        } finally {
            busy = false;
        }
    },
    async afterOrderValidation() {
        const order = this.currentOrder;
        if (!order || !order._qpQuickPay) {
            return super.afterOrderValidation(...arguments);
        }
        return withForcedDirectPrint(this.pos.config, () => super.afterOrderValidation(...arguments));
    },
});
