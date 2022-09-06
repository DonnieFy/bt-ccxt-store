import ccxt
import json

with open('../params.json', 'r') as f:
    params = json.load(f)

config = {
    'apiKey': params["binance"]["apikey"],
    'secret': params["binance"]["secret"],
    'enableRateLimit': True,
    'options': {
        'defaultType': 'future'
    }
}

exchange = ccxt.binance(config)
markets = exchange.load_markets()

# 设置交易对和杠杆
symbol = 'FOOTBALL/USDT'
market = markets[symbol]
exchange.set_leverage(leverage=5, symbol=symbol)

# 交易精度
min_amount = float(market['limits']['amount']['min'])
precision_amount = int(market['precision']['amount'])
min_price = float(market['limits']['price']['min'])
precision_price = int(market['precision']['price'])


def update_position():
    postions = exchange.fetch_positions(symbols=[symbol])


def update_trades():
    trades = exchange.fetch_trades(symbol=symbol, limit=200)


def update_depth():
    order_book = exchange.fetch_order_book(symbol=symbol)


def on_tick():
    a = 1


def main():
    while True:
        on_tick()
