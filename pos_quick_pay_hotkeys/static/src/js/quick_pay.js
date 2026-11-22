odoo.define('pos_quick_pay_hotkeys.quick_pay', function (require) {
    "use strict";

    /*
     * POS Quick Pay Hotkeys — Odoo 12 / 13
     * Author: Hamdy Mahran
     *
     *   F10  -> pay the full amount in CASH, print the receipt, start a new order
     *   F12  -> pay the full amount by CARD (شبكة / مدى), print, start a new order
     */

    var core = require('web.core');
    var chrome = require('point_of_sale.chrome');
    var screens = require('point_of_sale.screens');
    var _t = core._t;

    // غيّر المفاتيح هنا إن أردت
    var HOTKEYS = {F10: 'cash', F12: 'card'};
    var KEYCODES = {121: 'F10', 123: 'F12'};
    var CARD_NAME_RE = /شبك|مدى|mada|card|بطاق|visa|master|network|span|بنك|bank|pos/i;
    var BUSY_STATUSES = ['pending', 'waiting', 'waitingCard', 'waitingCapture', 'waitingCancel', 'reversing'];

    var busy = false;

    function hotkeyKind(ev) {
        var key = (ev.key && /^F\d+$/.test(ev.key)) ? ev.key : KEYCODES[ev.keyCode];
        return HOTKEYS[key];
    }

    function dialogOpen() {
        var els = document.querySelectorAll('.pos .modal-dialog');
        for (var i = 0; i < els.length; i++) {
            if (els[i].getClientRects().length && !$(els[i]).hasClass('oe_hidden')) {
                return true;
            }
        }
        return false;
    }

    // يحوّل طرق الدفع (يوميات 12 أو pos.payment.method في 13) إلى شكل موحّد
    function getMethods(pos) {
        if (pos.payment_methods) { // Odoo 13
            return pos.payment_methods.map(function (m) {
                return {raw: m, name: m.name || '', cash: !!m.is_cash_count, terminal: !!m.use_payment_terminal};
            });
        }
        return (pos.cashregisters || []).map(function (cr) { // Odoo 12
            var name = (cr.journal && cr.journal.name) || (cr.journal_id && cr.journal_id[1]) || '';
            return {raw: cr, name: name, cash: !!(cr.journal && cr.journal.type === 'cash'), terminal: false};
        });
    }

    function pickMethod(methods, kind) {
        var i;
        if (kind === 'cash') {
            for (i = 0; i < methods.length; i++) {
                if (methods[i].cash) { return methods[i]; }
            }
            return null;
        }
        var candidates = methods.filter(function (m) { return !m.cash; });
        for (i = 0; i < candidates.length; i++) {
            if (CARD_NAME_RE.test(candidates[i].name)) { return candidates[i]; }
        }
        return candidates[0] || null;
    }


    // ينتظر انتهاء الطباعة (أو إغلاق نافذة الطباعة) قبل فتح طلب جديد،
    // لأن كروم يلتقط الصفحة بعد استدعاء print() وليس لحظته.
    function waitAfterPrint() {
        var def = $.Deferred();
        var timer;
        var finish = function () {
            window.removeEventListener('afterprint', finish);
            clearTimeout(timer);
            def.resolve();
        };
        window.addEventListener('afterprint', finish);
        timer = setTimeout(finish, 60000);
        return def;
    }


    // ينتظر اكتمال صور الإيصال (رمز QR والشعار) قبل الطباعة،
    // لأن بعض مديولات الفاتورة الضريبية ترسم الـ QR بعد ظهور الإيصال.
    function receiptReady(root) {
        var imgs = root ? root.querySelectorAll('img') : [];
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if (!img.getAttribute('src') || !img.complete || !img.naturalWidth) {
                return false;
            }
        }
        return true;
    }
    function waitReceiptReady(root) {
        var def = $.Deferred();
        var start = Date.now();
        (function check() {
            var elapsed = Date.now() - start;
            if ((elapsed >= 600 && receiptReady(root)) || elapsed >= 5000) {
                def.resolve();
            } else {
                setTimeout(check, 100);
            }
        })();
        return def;
    }

    function quickPay(widget, kind) {
        var pos = widget.pos;
        var gui = widget.gui;
        var order = pos.get_order();
        if (!order || order.get_orderlines().length === 0) {
            return;
        }
        var method = pickMethod(getMethods(pos), kind);
        if (!method) {
            gui.show_popup('error', {
                title: _t('Quick Pay'),
                body: kind === 'cash'
                    ? _t('No cash payment method in this point of sale. / لا توجد طريقة دفع نقدية في نقطة البيع.')
                    : _t('No card payment method in this point of sale. / لا توجد طريقة دفع شبكة في نقطة البيع.'),
            });
            return;
        }
        var inProgress = order.get_paymentlines().some(function (l) {
            return l.payment_status && BUSY_STATUSES.indexOf(l.payment_status) !== -1;
        });
        if (inProgress) {
            gui.show_popup('error', {
                title: _t('Quick Pay'),
                body: _t('An electronic payment is in progress. / توجد عملية دفع إلكتروني قيد التنفيذ.'),
            });
            return;
        }

        if (gui.get_current_screen() !== 'payment') {
            gui.show_screen('payment');
        }
        var paymentScreen = gui.screen_instances.payment;

        order.get_paymentlines().slice().forEach(function (line) {
            order.remove_paymentline(line);
        });
        var due = order.get_due();
        order.add_paymentline(method.raw);
        if (order.selected_paymentline) {
            order.selected_paymentline.set_amount(due);
        }
        if (paymentScreen.reset_input) {
            paymentScreen.reset_input();
        }
        paymentScreen.render_paymentlines();

        if (method.terminal) {
            // جهاز دفع مربوط: يكمل الكاشير من شاشة الدفع (إرسال الطلب للجهاز)
            return;
        }

        order._qp_quick_pay = true;
        busy = true;
        try {
            paymentScreen.validate_order();
        } finally {
            busy = false;
        }
    }

    chrome.Chrome.include({
        build_widgets: function () {
            this._super.apply(this, arguments);
            var self = this;
            this._qpKeydown = function (ev) {
                var kind = hotkeyKind(ev);
                if (!kind) {
                    return;
                }
                var screen = self.gui.get_current_screen();
                if (screen !== 'products' && screen !== 'payment') {
                    return;
                }
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.repeat || busy || dialogOpen()) {
                    return;
                }
                quickPay(self, kind);
            };
            window.addEventListener('keydown', this._qpKeydown, true);
        },
        destroy: function () {
            if (this._qpKeydown) {
                window.removeEventListener('keydown', this._qpKeydown, true);
            }
            this._super.apply(this, arguments);
        },
    });

    // طباعة مباشرة ثم الانتقال لطلب جديد بدون المرور بشاشة الإيصال
    screens.ReceiptScreenWidget.include({
        _qpUsesProxy: function () {
            return !!(this.pos.config.iface_print_via_proxy || (this.pos.proxy && this.pos.proxy.printer));
        },
        handle_auto_print: function () {
            var order = this.pos.get_order();
            if (order && order._qp_quick_pay && !order._printed && !this._qpUsesProxy()) {
                var self = this;
                this.lock_screen(true);
                waitReceiptReady(this.el).then(function () {
                    if (self.pos.get_order() !== order || order._printed) {
                        return;
                    }
                    waitAfterPrint().then(function () {
                        var finalized = order.is_to_invoice() ? order.finalized : true;
                        if (self.pos.get_order() === order && finalized) {
                            self.click_next();
                        }
                    });
                    self.print();
                });
                return;
            }
            return this._super.apply(this, arguments);
        },
        should_auto_print: function () {
            var order = this.pos.get_order();
            if (order && order._qp_quick_pay) {
                return !order._printed;
            }
            return this._super.apply(this, arguments);
        },
        should_close_immediately: function () {
            var order = this.pos.get_order();
            if (order && order._qp_quick_pay) {
                return order.is_to_invoice() ? order.finalized : true;
            }
            return this._super.apply(this, arguments);
        },
    });

    return {pickMethod: pickMethod, HOTKEYS: HOTKEYS};
});
