import ccxt
import json
from pprint import pprint


def table(values):
    first = values[0]
    keys = list(first.keys()) if isinstance(first, dict) else range(0, len(first))
    widths = [max([len(str(v[k])) for v in values]) for k in keys]
    string = ' | '.join(['{:<' + str(w) + '}' for w in widths])
    return "\n".join([string.format(*[str(v[k]) for k in keys]) for v in values])


def table1(values):
    result = set()
    for v in values:
        vsymbol = v['symbol']
        if 'USDT' in vsymbol and '_' not in vsymbol:
            result.add(vsymbol)
    arr = list(result)
    return "\n".join(arr)

with open('../samples/params.json', 'r') as f:
    params = json.load(f)


exchange = ccxt.binance({
    'apiKey': params["binance"]["apikey"],
    'secret': params["binance"]["secret"],
    'options': {
        'defaultType': 'future',
    },
})

markets = exchange.load_markets()

for market in markets:
    print(market)
symbol = 'BTC/USDT'  # YOUR SYMBOL HERE
market = exchange.market(symbol)
trades = exchange.fetch_my_trades(symbol)
print(trades)

data = exchange.fetch_ohlcv('BTCSTUSDT', timeframe='1m', limit=50)
# print(data)

#
# exchange.verbose = True  # UNCOMMENT THIS AFTER LOADING THE MARKETS FOR DEBUGGING
#
# print('----------------------------------------------------------------------')
#
# print('Fetching your balance:')
# response = exchange.fetch_balance()
# pprint(response['total'])  # make sure you have enough futures margin...
# # pprint(response['info'])  # more details
#
# print('----------------------------------------------------------------------')
#
# # https://binance-docs.github.io/apidocs/futures/en/#position-information-v2-user_data
#
# print('Getting your positions:')
# response = exchange.fapiPrivateV2_get_positionrisk()
# #print(table1(response))
#
# print('----------------------------------------------------------------------')
#
# # https://binance-docs.github.io/apidocs/futures/en/#change-position-mode-trade
#
# print('Getting your current position mode (One-way or Hedge Mode):')
# response = exchange.fapiPrivate_get_positionside_dual()
# if response['dualSidePosition']:
#     print('You are in Hedge Mode')
# else:
#     print('You are in One-way Mode')
#
# print('----------------------------------------------------------------------')

# print('Setting your position mode to One-way:')
# response = exchange.fapiPrivate_post_positionside_dual({
#     'dualSidePosition': False,
# })
# print(response)

# print('Setting your positions to Hedge mode:')
# response = exchange.fapiPrivate_post_positionside_dual({
#     'dualSidePosition': True,
# })
# print(response)

# print('----------------------------------------------------------------------')

# # https://binance-docs.github.io/apidocs/futures/en/#change-margin-type-trade

# print('Changing your', symbol, 'position margin mode to CROSSED:')
# response = exchange.fapiPrivate_post_margintype({
#     'symbol': market['id'],
#     'marginType': 'CROSSED',
# })
# print(response)

# print('Changing your', symbol, 'position margin mode to ISOLATED:')
# response = exchange.fapiPrivate_post_margintype({
#     'symbol': market['id'],
#     'marginType': 'ISOLATED',
# })
# print(response)

# print('----------------------------------------------------------------------')

# # https://binance-docs.github.io/apidocs/spot/en/#new-future-account-transfer-futures

# code = 'USDT'
# amount = 123.45
# currency = exchange.currency(code)

# print('Moving', code, 'funds from your spot account to your futures account:')

# response = exchange.sapi_post_futures_transfer({
#     'asset': currency['id'],
#     'amount': exchange.currency_to_precision(code, amount),
#     # 1: transfer from spot account to USDT-Ⓜ futures account.
#     # 2: transfer from USDT-Ⓜ futures account to spot account.
#     # 3: transfer from spot account to COIN-Ⓜ futures account.
#     # 4: transfer from COIN-Ⓜ futures account to spot account.
#     'type': 1,
# })

# print('----------------------------------------------------------------------')

# # for ISOLATED positions only
# print('Modifying your ISOLATED', symbol, 'position margin:')
# response = exchange.fapiPrivate_post_positionmargin({
#     'symbol': market['id'],
#     'amount': 123.45,  # ←-------------- YOUR AMOUNT HERE
#     'positionSide': 'BOTH',  # use BOTH for One-way positions, LONG or SHORT for Hedge Mode
#     'type': 1,  # 1 = add position margin, 2 = reduce position margin
# })

# print('----------------------------------------------------------------------')