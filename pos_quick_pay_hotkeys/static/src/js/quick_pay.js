odoo.define('pos_quick_pay_hotkeys.quick_pay', function (require) {
    'use strict';

    /*
     * POS Quick Pay Hotkeys — Odoo 16
     * Author: Hamdy Mahran
     *
     *   F10  -> pay the full amount in CASH, print the receipt, start a new order
     *   F12  -> pay the full amount by CARD (شبكة / مدى), print, start a new order
     */

    const Registries = require('point_of_sale.Registries');
    const ProductScreen = require('point_of_sale.ProductScreen');
    const PaymentScreen = require('point_of_sale.PaymentScreen');
    const ReceiptScreen = require('point_of_sale.ReceiptScreen');
    const { _t } = require('web.core');
    const { onMounted, onWillUnmount } = owl;

    // غيّر المفاتيح هنا إن أردت
    const HOTKEYS = { F10: 'cash', F12: 'card' };
    const KEYCODES = { 121: 'F10', 123: 'F12' };
    const CARD_NAME_RE = /شبك|مدى|mada|card|بطاق|visa|master|network|span|بنك|bank|pos/i;

    let busy = false;

    function hotkeyKind(ev) {
        const key = ev.key && /^F\d+$/.test(ev.key) ? ev.key : KEYCODES[ev.keyCode];
        return HOTKEYS[key];
    }

    function dialogOpen() {
        return [...document.querySelectorAll('.pos .modal-dialog, .o_dialog')].some(
            (el) => el.getClientRects().length > 0
        );
    }

    function configMethods(pos) {
        const ids = pos.config.payment_method_ids || [];
        return pos.payment_methods.filter((m) => !ids.length || ids.includes(m.id));
    }

    function pickMethod(methods, kind) {
        const usable = methods.filter((m) => m.type !== 'pay_later');
        if (kind === 'cash') {
            return usable.find((m) => m.is_cash_count) || null;
        }
        const card = usable.filter((m) => !m.is_cash_count);
        return card.find((m) => CARD_NAME_RE.test(m.name || '')) || card[0] || null;
    }

    function noMethodMessage(kind) {
        return kind === 'cash'
            ? _t('No cash payment method in this point of sale. / لا توجد طريقة دفع نقدية في نقطة البيع.')
            : _t('No card payment method in this point of sale. / لا توجد طريقة دفع شبكة في نقطة البيع.');
    }

    // يربط مستمع لوحة المفاتيح بالشاشة طوال فترة ظهورها
    function bindKeys(component, onKind) {
        component._qpKeydown = (ev) => {
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
        window.addEventListener('keydown', component._qpKeydown, true);
    }

    function unbindKeys(component) {
        if (component._qpKeydown) {
            window.removeEventListener('keydown', component._qpKeydown, true);
            component._qpKeydown = null;
        }
    }

    const QuickPayProductScreen = (ProductScreen) =>
        class extends ProductScreen {
            setup() {
                super.setup();
                onMounted(() => bindKeys(this, (kind) => this._qpQuickPay(kind)));
                onWillUnmount(() => unbindKeys(this));
            }
            async _qpQuickPay(kind) {
                const order = this.env.pos.get_order();
                if (!order || !order.get_orderlines().length) {
                    return;
                }
                const method = pickMethod(configMethods(this.env.pos), kind);
                if (!method) {
                    await this.showPopup('ErrorPopup', { title: _t('Quick Pay'), body: noMethodMessage(kind) });
                    return;
                }
                order._qpMethodId = method.id;
                await this._onClickPay();
            }
        };
    Registries.Component.extend(ProductScreen, QuickPayProductScreen);

    const QuickPayPaymentScreen = (PaymentScreen) =>
        class extends PaymentScreen {
            setup() {
                super.setup();
                onMounted(() => this._qpOnMounted());
                onWillUnmount(() => unbindKeys(this));
            }
            _qpOnMounted() {
                bindKeys(this, (kind) => {
                    const method = pickMethod(configMethods(this.env.pos), kind);
                    if (!method) {
                        this.showPopup('ErrorPopup', { title: _t('Quick Pay'), body: noMethodMessage(kind) });
                        return;
                    }
                    this._qpPayWith(method);
                });
                // قادم من شاشة المنتجات بعد الضغط على F10 / F12
                const order = this.currentOrder;
                if (order && order._qpMethodId) {
                    const method = this.env.pos.payment_methods.find((m) => m.id === order._qpMethodId);
                    delete order._qpMethodId;
                    if (method) {
                        this._qpPayWith(method);
                    }
                }
            }
            async _qpPayWith(method) {
                if (busy) {
                    return;
                }
                const order = this.currentOrder;
                if (order.electronic_payment_in_progress && order.electronic_payment_in_progress()) {
                    await this.showPopup('ErrorPopup', {
                        title: _t('Quick Pay'),
                        body: _t('An electronic payment is in progress. / توجد عملية دفع إلكتروني قيد التنفيذ.'),
                    });
                    return;
                }
                for (const line of [...order.get_paymentlines()]) {
                    order.remove_paymentline(line);
                }
                const due = order.get_due();
                if (!this.addNewPaymentLine({ detail: method })) {
                    return;
                }
                if (order.selected_paymentline) {
                    order.selected_paymentline.set_amount(due);
                }
                if (method.use_payment_terminal) {
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
            }
        };
    Registries.Component.extend(PaymentScreen, QuickPayPaymentScreen);

    // طباعة مباشرة ثم الانتقال لطلب جديد
    const QuickPayReceiptScreen = (ReceiptScreen) =>
        class extends ReceiptScreen {
            _shouldAutoPrint() {
                const order = this.currentOrder;
                if (order && order._qpQuickPay) {
                    return !order._printed;
                }
                return super._shouldAutoPrint(...arguments);
            }
            _shouldCloseImmediately() {
                const order = this.currentOrder;
                if (order && order._qpQuickPay) {
                    return order.is_to_invoice() ? order.finalized : true;
                }
                return super._shouldCloseImmediately(...arguments);
            }
        };
    Registries.Component.extend(ReceiptScreen, QuickPayReceiptScreen);

    return { pickMethod, HOTKEYS };
});
