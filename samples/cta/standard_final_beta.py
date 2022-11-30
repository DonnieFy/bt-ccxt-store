from ccxtbt import CCXTStore
import backtrader as bt
from datetime import datetime, timedelta
import json
import pytz
from backtrader import Order
import logging
import ccxt

const_pnt = 'pnt_45'
const_pnt_30 = 'pnt_30'
const_high = 'high_15'
const_low = 'low_15'
const_period = 60  # 计算周期
const_hold_period = 60  # 持仓周期
const_stop_loss = 0.95  # 止损
const_agree = 0.8  # 一致性比率
const_period_range = 7  # 和过去多少个周期比较
const_factor = 10  # 涨幅超过平均涨幅因子
const_min_pnt = 0.04  # 最小涨幅
const_max_pnt = 0.08  # 最大涨幅


class TestStrategy(bt.Strategy):

    def __init__(self):
        self.wintimes = 0
        self.losetimes = 0
        self.inds = dict()
        self.live_data = False
        self.position_datas = set()
        self.position_datas2 = set()
        self.position_dates = dict()
        self.position_prices = dict()
        self.position_stop_loss = dict()
        self.position_stop_interval = dict()
        self.sell_60_dates = dict()
        self.sell_60_pnts = dict()
        self.position_type = dict()
        self.position_type_win_time = dict()
        self.position_type_lose_time = dict()
        self.position_type_win_money = dict()
        self.position_type_lose_money = dict()
        self.logger = logging.getLogger()
        self.logger.setLevel(logging.INFO)
        self.pre_sells = []
        self.pre_sells2 = []
        handler = logging.FileHandler('logfile_final.log', encoding='UTF-8')
        handler.setLevel(logging.INFO)
        self.logger.addHandler(handler)
        self.sma = bt.indicators.SMA(self.datas[0], period=1200)
        self.sma_450 = bt.indicators.SMA(self.datas[0], period=450)
        # self.sma_99 = bt.indicators.SMA(self.datas[0], period=99)
        self.ratios = dict()
        for d in self.datas:
            self.inds[d] = dict()
            self.inds[d]["pnt_30"] = bt.indicators.PctChange(d.close, period=30)
            self.inds[d]["high_30"] = bt.indicators.Highest(d.high, period=30)
            self.inds[d]["low_30"] = bt.indicators.Lowest(d.low, period=30)
            self.inds[d]["pnt_15"] = bt.indicators.PctChange(d.close, period=15)
            self.inds[d]["high_15"] = bt.indicators.Highest(d.high, period=15)
            self.inds[d]["low_15"] = bt.indicators.Lowest(d.low, period=15)
            # self.inds[d]["pnt_45"] = bt.indicators.PctChange(d.close, period=45)
            # self.inds[d]["high_45"] = bt.indicators.Highest(d.high, period=45)
            # self.inds[d]["low_45"] = bt.indicators.Lowest(d.low, period=45)
            # self.inds[d]["pnt_60"] = bt.indicators.PctChange(d.close, period=60)
            # self.inds[d]["low_60"] = bt.indicators.Lowest(d.low, period=60)
            # self.inds[d]["high_60"] = bt.indicators.Highest(d.high, period=60)
            # self.inds[d]['sma_99'] = bt.indicators.SMA(d, period=99)
            # self.inds[d]['sma_80'] = bt.indicators.SMA(d, period=80)
            self.inds[d]['sma_300'] = bt.indicators.SMA(d, period=300)
            self.inds[d]['sma_1200'] = bt.indicators.SMA(d, period=1200)
            # self.inds[d]['volume'] = bt.indicators.SumN(d.volume, period=480)
            # self.inds[d][const_pnt_30] = bt.indicators.PctChange(d.close, period=60)
            # self.inds[d][const_high] = bt.indicators.Highest(d.high, period=const_period)
            # self.inds[d][const_low] = bt.indicators.Lowest(d.low, period=const_period)

    def calc_avg(self, d, i, pnt_name, period):
        pnts = []
        for offset in range(6):
            pnts.append(abs(self.inds[d][pnt_name][(-1 - offset) * period + i]))
        pnt = self.inds[d][pnt_name][i]
        pnts_sum = sum(pnts)
        if pnts_sum == 0:
            self.log(','.join([str(i) for i in pnts]))
        return (pnt * len(pnts) / pnts_sum) if pnts_sum != 0 else 100

    def calc_agree(self, d, i, pnt_name, high_name, low_name):
        high = self.inds[d][high_name][i]
        low = self.inds[d][low_name][i]
        pnt = self.inds[d][pnt_name][i]
        return pnt*low/(high-low)

    def calc_volume(self, d):
        volume = self.inds[d]['volume'][0]
        return d.close[0] * volume

    def next(self):
        current_date = self.datas[0].datetime.datetime()

        # long_888 = True
        # long_450 = True
        # short_450 = True
        # short_888 = True
        # for i in range(15):
        #     if self.datas[0].close[-i] < self.sma[-i]:
        #         long_888 = False
        #     elif self.datas[0].close[-i] > self.sma[-i]:
        #         short_888 = False
        #     if self.datas[0].close[-i] < self.sma_450[-i]:
        #         long_450 = False
        #     elif self.datas[0].close[-i] > self.sma_450[-i]:
        #         short_450 = False

        btc = self.datas[0]
        long = btc.close[0] > self.sma_450[0] and btc.close[-1] > self.sma_450[-1] and btc.close[-2] > self.sma_450[-2]
        short = btc.close[0] < self.sma_450[0] and btc.close[-1] < self.sma_450[-1] and btc.close[-2] < self.sma_450[-2]
        for d in self.datas:
            if d in self.position_datas:
                continue
            name = d._name
            if long:
                pnt = self.inds[d]['pnt_15'][0]
                pnt_name = 'pnt_15'
                high_name = 'high_15'
                low_name = 'low_15'
                if pnt >= 0.06 and self.calc_avg(d, 0, pnt_name, 15) >= 10 and self.calc_agree(d, 0, pnt_name, high_name, low_name) >= 0.8:
                    # btc>450sma，15分钟>=0.06，15分钟>10*avg6，agree>0.8，1次确认做多，持仓60分钟
                    self.open_position(d=d, date=current_date, side='buy', pnt=pnt, interval=60, position_type='buy60')
                if pnt >= 0.01 and self.inds[d]['pnt_15'][-1] >= 0.01 and self.inds[d]['pnt_15'][-2] >= 0.01 and \
                        self.calc_avg(d, 0, pnt_name, 15) >= 10 and self.calc_avg(d, -1, pnt_name, 15) >= 10 and self.calc_avg(d, -2, pnt_name, 15) >= 10 \
                        and self.calc_agree(d, 0, pnt_name, high_name, low_name) >= 0.8 \
                        and self.calc_agree(d, -1, pnt_name, high_name, low_name) >= 0.8 \
                        and self.calc_agree(d, -2, pnt_name, high_name, low_name) >= 0.8:
                    # btc>450sma，15分钟>=0.01，15分钟>10*avg6，agree>0.8，3次确认做多，持仓15分钟
                    self.open_position(d=d, date=current_date, side='buy', pnt=pnt, interval=15, position_type='buy15')
                # if pnt < 0.04 < self.inds[d]['pnt_30'][0] < 0.08 \
                #         and self.inds[d]['pnt_15'][-1] < 0.04 < self.inds[d]['pnt_30'][-1] < 0.08 \
                #         and self.inds[d]['pnt_15'][-2] < 0.04 < self.inds[d]['pnt_30'][-2] < 0.08 \
                #         and d.close[0] > self.inds[d]['sma_300'][0] > self.inds[d]['sma_1200'][0]:
                #     self.open_position(d=d, date=current_date, side='buy', pnt=self.inds[d]['pnt_30'][0], interval=45, position_type='buy45')

            if short:
                pnt_15 = self.inds[d]['pnt_15'][0]
                if -0.05 <= pnt_15 <= -0.04 and -0.05 <= self.inds[d]['pnt_15'][-1] <= -0.04 and \
                        d.close[0] < self.inds[d]['sma_99'][0] and d.close[-1] < self.inds[d]['sma_99'][-1] \
                        and self.calc_agree(d, 0, 'pnt_15', 'high_15', 'low_15') <= -0.8 \
                        and self.calc_agree(d, -1, 'pnt_15', 'high_15', 'low_15') <= -0.8:
                    # btc<450sma，15分钟 in (-0.5, -0.4) and close<99sma and agree<=-0.8，2次确认做空，持仓15分钟
                    self.open_position(d=d, date=current_date, side='sell', pnt=pnt_15, interval=15, position_type='sell15')

                # pnt_60 = self.inds[d]['pnt_60'][0]
                # if -0.05 <= pnt_60 <= -0.04 and \
                #         -0.05 <= self.inds[d]['pnt_60'][-1] <= -0.04 and \
                #         -0.05 <= self.inds[d]['pnt_60'][-2] <= -0.04 and \
                #         d.close[0] < self.inds[d]['sma_210'][0] and \
                #         d.close[-1] < self.inds[d]['sma_210'][-1] and \
                #         d.close[-2] < self.inds[d]['sma_210'][-2] and \
                #         self.calc_agree(d, 0, 'pnt_60', 'high_60', 'low_60') <= -0.8 and\
                #         self.calc_agree(d, -1, 'pnt_60', 'high_60', 'low_60') <= -0.8 and\
                #         self.calc_agree(d, -2, 'pnt_60', 'high_60', 'low_60') <= -0.8:
                #     # btc<450sma，60分钟 in (-0.5, -0.4) and close<210sma and agree<=-0.8，3次确认做空，持仓30分钟
                #     self.position_datas2.add(d)
                #     if d in self.position_datas:
                #         if self.position_stop_interval[d._name] < 30:
                #             self.position_stop_interval[d._name] = 30
                #     else:
                #         self.open_position(d=d, date=current_date, side='sell', pnt=pnt_60, interval=30)

            # pnt_45 = self.inds[d]['pnt_45'][0]
            # if not long_888 and not long_888_1 and not long_888_2 and \
            #         pnt_45 >= 0.06 and self.calc_avg(d, 0, 'pnt_45', 45) >= 10 and self.calc_agree(d, 0, 'pnt_45', 'high_45', 'low_45') >= 0.8:
            #     self.open_position(d=d, date=current_date, side='sell', pnt=pnt_45, interval=60, position_type='sell60')

            # if long_888 and long_888_1 and long_888_2:
            #     pnt_30 = self.inds[d]['pnt_30'][0]
            #     if pnt_30 >= 0.04 and self.inds[d]['pnt_30'][-1] >= 0.04 and self.inds[d]['pnt_30'][-2] >= 0.04 and \
            #             self.calc_avg(d, 0, 'pnt_30', 30) >= 10 and \
            #             self.calc_avg(d, -1, 'pnt_30', 30) >= 10 and \
            #             self.calc_avg(d, -2, 'pnt_30', 30) >= 10 and \
            #             self.calc_agree(d, 0, 'pnt_30', 'high_30', 'low_30') >= 0.8 and \
            #             self.calc_agree(d, -1, 'pnt_30', 'high_30', 'low_30') >= 0.8 and \
            #             self.calc_agree(d, -2, 'pnt_30', 'high_30', 'low_30') >= 0.8:
            #         self.open_position(d=d, date=current_date, side='buy', pnt=pnt_30, interval=45, position_type='buy45')

        for d in set(self.position_datas):
            pos = self.getposition(d)
            size = pos.size
            name = d._name
            interval = (current_date - self.position_dates[name]).seconds / 60
            self.update_stop_loss(d)

            if size < 0:
                if interval > self.position_stop_interval[name] or d.close[0] > self.position_stop_loss[name]:
                    self.close_position(data=d, size=size, side='buy')
            elif size > 0:
                if interval > self.position_stop_interval[name] or d.close[0] < self.position_stop_loss[name]:
                    self.close_position(data=d, size=size, side='sell')

    def update_stop_loss(self, data):
        name = data._name
        pos = self.getposition(data)
        change = data.close[0] - data.open[0]
        if pos.size > 0 > change:
            self.position_stop_loss[name] -= change
        elif pos.size < 0 < change:
            self.position_stop_loss[name] -= change

    def open_position(self, d, date, side, pnt, interval, position_type):
        total_value = self.broker.getvalue()
        cash = self.broker.getcash()
        if cash > total_value:
            cash = 2 * total_value - cash
        self.log('账户价值：%s, 现金: %s' % (total_value, cash))
        ratio = (total_value // 1000)
        total_value = (300 * ratio if ratio > 0 else 300)
        if total_value > cash:
            return
        size = total_value / d.close[0]
        name = d._name
        self.position_dates[name] = date
        self.position_prices[name] = d.close[0]
        self.position_stop_interval[name] = interval
        self.position_type[name] = position_type
        self.position_datas.add(d)

        pnt = abs(pnt)
        if pnt > 0.04:
            pnt = 0.04
        if side == 'sell':
            self.sell(data=d, size=size, exectype=Order.Market)
            self.position_stop_loss[name] = d.close[0] * (1 + pnt)
        elif side == 'buy':
            self.buy(data=d, size=size, exectype=Order.Market)
            self.position_stop_loss[name] = d.close[0] * (1 - pnt)

    # 关闭一个仓位
    def close_position(self, data, size, side):
        name = data._name
        if side == 'buy':
            self.buy(data=data, size=size, exectype=Order.Market)
            change = self.position_prices[name] - data.close[0]
        elif side == 'sell':
            self.sell(data=data, size=size, exectype=Order.Market)
            change = data.close[0] - self.position_prices[name]

        pnl = change * size
        postion_type = self.position_type[name]
        if postion_type not in self.position_type_win_time:
            self.position_type_win_time[postion_type] = 0
        if postion_type not in self.position_type_lose_time:
            self.position_type_lose_time[postion_type] = 0
        if postion_type not in self.position_type_win_money:
            self.position_type_win_money[postion_type] = 0
        if postion_type not in self.position_type_lose_money:
            self.position_type_lose_money[postion_type] = 0

        if pnl > 0:
            self.position_type_win_time[postion_type] += 1
            self.position_type_win_money[postion_type] += pnl
        else:
            self.position_type_lose_time[postion_type] += 1
            self.position_type_lose_money[postion_type] += pnl

        self.position_dates[name] = None
        self.position_prices[name] = None
        self.position_stop_loss[name] = None
        self.position_stop_interval[name] = None
        self.position_datas.remove(data)
        self.position_datas2.remove(data) if data in self.position_datas2 else None
        self.position_type[name] = None

    def stop(self):
        for name in self.position_type_lose_money:
            self.log('TYPE %s, WIN TIMES %s, LOSE TIMES %s, WIN MONEY %s LOSE MONEY %s ' %
                     (name, self.position_type_win_time[name], self.position_type_lose_time[name],
                      self.position_type_win_money[name], self.position_type_lose_money[name]))

    def notify_data(self, data, status, *args, **kwargs):
        dn = data._name
        dt = datetime.now(tz=pytz.timezone('Asia/Shanghai'))
        msg = 'Data Status: {}, Name: {}'.format(data._getstatusname(status), dn)
        print(dt, msg)
        if data._getstatusname(status) == 'LIVE':
            self.live_data = True
        else:
            self.live_data = False

    def notify_trade(self, trade):
        if not trade.isclosed:
            return
        if trade.pnl > 0:
            self.wintimes += 1
        else:
            self.losetimes += 1
        name = trade.data._name
        self.log('OPERATION PROFIT, GROSS %.2f, NET %.2f, WIN %s LOSE %s TOTAL %s, NAME %s' %
                 (trade.pnl, trade.pnlcomm, self.wintimes, self.losetimes, self.wintimes + self.losetimes, name))

    def notify_order(self, order):
        if order.status in [order.Submitted, order.Accepted]:
            # Buy/Sell order submitted/accepted to/by broker - Nothing to do
            return
        order.executed
        # Check if an order has been completed
        # Attention: broker could reject order if not enough cash
        if order.status in [order.Completed]:
            name = order.data._name
            if order.isbuy():
                self.log(
                    'BUY EXECUTED, Price: %.2f, Cost: %.2f, Comm %.2f, size %.2f, Name: %s' %
                    (order.executed.price,
                     order.executed.value,
                     order.executed.comm,
                     order.executed.size,
                     name))

            else:  # Sell
                self.log('SELL EXECUTED, Price: %.2f, Cost: %.2f, Comm %.2f, size %.2f, Name: %s' %
                         (order.executed.price,
                          order.executed.value,
                          order.executed.comm,
                          order.executed.size,
                          name))
        elif order.status in [order.Canceled, order.Margin, order.Rejected]:
            ordertype = 'buy' if order.isbuy() else 'sell'
            status = 'canceled' if order.status == order.Canceled else \
                'margin' if order.status == order.Margin else 'rejected'
            self.log('%s Order %s' % (ordertype, status))

    def log(self, txt, dt=None, tm=None):
        """ Logging function fot this strategy"""
        dtt = self.datas[0].datetime.datetime(tz=pytz.timezone('Asia/Shanghai'))
        dt = dt or dtt.date()
        tm = tm or dtt.time()
        msg = '%s, %s, %s' % (dt.isoformat(), tm, txt)
        self.logger.info(msg)
        print(msg)


with open('../params.json', 'r') as f:
    params = json.load(f)

cerebro = bt.Cerebro(quicknotify=True)

# Add the strategy
cerebro.addobserver(bt.observers.DrawDown)
cerebro.addstrategy(TestStrategy)
cerebro.broker.setcash(100000)
# 设置交易手续费为 0.1%
cerebro.broker.setcommission(commission=0.004, mult=10)

# Create our store
config = {'apiKey': params["binance"]["apikey"],
          # 'secret': params["binance"]["secret"],
          'enableRateLimit': True,
          'options': {
              'defaultType': 'future'
            }
          }

exchange = ccxt.binance(config)

with open('../symbols.txt', 'r') as f:
    symbols = f.read().split(" ")


# IMPORTANT NOTE - Kraken (and some other exchanges) will not return any values
# for get cash or value if You have never held any BNB coins in your account.
# So switch BNB to a coin you have funded previously if you get errors
store = CCXTStore(exchange='binance', currency='USDT', config=config, retries=5, debug=False)

# Get our data
# Drop newest will prevent us from loading partial data from incomplete candles

# utcnow = datetime.utcfromtimestamp(int((datetime.utcnow() - datetime(1970, 1, 1)).total_seconds() // 60) * 60)
utcnow = datetime.utcfromtimestamp(1666779060000 // 1000)
hist_start_date = utcnow - timedelta(minutes=60 * 24 * 80 * 1)
hist_end_date = utcnow + timedelta(minutes=60 * 24 * 19 * 1)
data0 = None
for v in symbols:
    data = store.getdata(dataname=v, name=v, market='future',
                     timeframe=bt.TimeFrame.Minutes, fromdate=hist_start_date, todate=hist_end_date,
                     compression=1, ohlcv_limit=1000, debug=False, historical=True)
    # Add the feed
    if data0 is None:
        data0 = data
    else:
        data.plotinfo.plot = False
    cerebro.adddata(data)

# Run the strategy
cerebro.run()
cerebro.plot()
