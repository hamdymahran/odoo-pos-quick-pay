# -*- coding: utf-8 -*-
{
    'name': 'POS Quick Pay Hotkeys (F10 Cash / F12 Card)',
    'summary': 'Pay the whole POS order with one key: F10 cash, F12 card, '
               'then print the receipt and start a new order | دفع سريع نقدي وشبكة مع طباعة مباشرة',
    'description': """
POS Quick Pay Hotkeys
=====================
* F10: pay the full amount in cash, validate, print the receipt, new order.
* F12: pay the full amount by card (bank / mada), validate, print the receipt, new order.

دفع سريع بالكيبورد: F10 نقدي و F12 شبكة، مع طباعة الإيصال مباشرة وفتح طلب جديد.
""",
    'version': '12.0.1.0.0',
    'category': 'Point of Sale',
    'author': 'Hamdy Mahran',
    'maintainer': 'Hamdy Mahran',
    'website': 'https://github.com/hamdymahran',
    'license': 'LGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'views/assets.xml',
    ],
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': False,
    'auto_install': False,
}
