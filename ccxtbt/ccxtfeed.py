#!/usr/bin/env python
# -*- coding: utf-8; py-indent-offset:4 -*-
###############################################################################
#
# Copyright (C) 2015, 2016, 2017 Daniel Rodriguez
# Copyright (C) 2017 Ed Bartosh
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
###############################################################################
from __future__ import (absolute_import, division, print_function,
                        unicode_literals)

import time
import csv
from collections import deque
from datetime import datetime

import backtrader as bt
from backtrader.feed import DataBase
from backtrader.utils.py3 import with_metaclass

from .ccxtstore import CCXTStore


class MetaCCXTFeed(DataBase.__class__):
    def __init__(cls, name, bases, dct):
        '''Class has already been created ... register'''
        # Initialize the class
        super(MetaCCXTFeed, cls).__init__(name, bases, dct)

        # Register with the store
        CCXTStore.DataCls = cls


class CCXTFeed(with_metaclass(MetaCCXTFeed, DataBase)):
    """
    CryptoCurrency eXchange Trading Library Data Feed.
    Params:
      - ``historical`` (default: ``False``)
        If set to ``True`` the data feed will stop after doing the first
        download of data.
        The standard data feed parameters ``fromdate`` and ``todate`` will be
        used as reference.
      - ``backfill_start`` (default: ``True``)
        Perform backfilling at the start. The maximum possible historical data
        will be fetched in a single request.

    Changes From Ed's pacakge

        - Added option to send some additional fetch_ohlcv_params. Some exchanges (e.g Bitmex)
          support sending some additional fetch parameters.
        - Added drop_newest option to avoid loading incomplete candles where exchanges
          do not support sending ohlcv params to prevent returning partial data

    """

    params = (
        ('historical', False),  # only historical download
        ('backfill_start', False),  # do backfilling at the start
        ('fetch_ohlcv_params', {}),
        ('ohlcv_limit', 20),
        ('drop_newest', False),
        ('debug', False)
    )

    _store = CCXTStore

    # States for the Finite State Machine in _load
    _ST_LIVE, _ST_HISTORBACK, _ST_OVER = range(3)

    _interval = {
        '1m': 60 * 1000,
        '15m': 15 * 60 * 1000
    }

    # def __init__(self, exchange, symbol, ohlcv_limit=None, config={}, retries=5):
    def __init__(self, **kwargs):
        # self.store = CCXTStore(exchange, config, retries)
        self.store = self._store(**kwargs)
        self._data = deque()  # data queue for price data
        self._last_id = ''  # last processed trade id for ohlcv
        self._last_ts = 0  # last processed timestamp for ohlcv

    def start(self, ):
        DataBase.start(self)

        if self.p.fromdate:
            self._state = self._ST_HISTORBACK
            self.put_notification(self.DELAYED)
            self._fetch_ohlcv(self.p.fromdate, todate=self.p.todate)

        else:
            self._state = self._ST_LIVE
            self.put_notification(self.LIVE)

    def _load(self):
        if self._state == self._ST_OVER:
            return False

        while True:
            if self._state == self._ST_LIVE:
                if self._timeframe == bt.TimeFrame.Ticks:
                    return self._load_ticks()
                else:
                    self._fetch_ohlcv()
                    ret = self._load_ohlcv()
                    if self.p.debug:
                        print('----     LOAD    ----')
                        print('{} Load OHLCV Returning: {}'.format(datetime.utcnow(), ret))
                    return ret

            elif self._state == self._ST_HISTORBACK:
                ret = self._load_ohlcv()
                if ret:
                    return ret
                else:
                    # End of historical data
                    if self.p.historical:  # only historical
                        self.put_notification(self.DISCONNECTED)
                        self._state = self._ST_OVER
                        return False  # end of historical
                    else:
                        self._state = self._ST_LIVE
                        self.put_notification(self.LIVE)
                        continue

    def _fetch_ohlcv(self, fromdate=None, todate=None):
        """Fetch OHLCV data into self._data queue"""
        granularity = self.store.get_granularity(self._timeframe, self._compression)

        if fromdate:
            since = int((fromdate - datetime(1970, 1, 1)).total_seconds() * 1000)
            end_date = int((todate - datetime(1970, 1, 1)).total_seconds() * 1000) if todate is not None else None
        else:
            if self._last_ts > 0:
                since = self._last_ts
            else:
                since = None
            end_date = None

        limit = self.p.ohlcv_limit

        interval = self._interval[granularity]

        data_from_ccxt = False

        symbol = self.p.dataname.replace('/', '')
        if granularity != '1m':
            symbol += '_' + granularity

        data = []
        try:
            with open('../data/' + symbol + '.csv', 'r', newline='') as f:
                reader = csv.reader(f)
                for row in reader:
                    ohlcv = [int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])]
                    tstamp = ohlcv[0]

                    if end_date is not None and tstamp > end_date:
                        break
                    if since is not None and tstamp < since:
                        continue

                    data.append(ohlcv)
        except Exception as e:
            data

        while True:
            dlen = len(self._data)

            if data_from_ccxt or len(data) == 0:
                data = sorted(self.store.fetch_ohlcv(self.p.dataname, timeframe=granularity,
                                                     since=since, limit=limit, params=self.p.fetch_ohlcv_params))
                data_from_ccxt = True

            if self.p.debug:
                # TESTING
                since_dt = datetime.utcfromtimestamp(since // 1000) if since is not None else 'NA'
                print('---- NEW REQUEST ----')
                print('{} - Requesting: Since TS {} Since date {} granularity {}, limit {}, params'.format(
                    datetime.utcnow(), since, since_dt, granularity, limit, self.p.fetch_ohlcv_params))
                try:
                    for i, ohlcv in enumerate(data):
                        tstamp, open_, high, low, close, volume = ohlcv
                        print('{} - Data {}: {} - TS {} Time {}'.format(datetime.utcnow(), i,
                                                                        datetime.utcfromtimestamp(tstamp // 1000),
                                                                        tstamp, (time.time() * 1000)))
                        # ------------------------------------------------------------------
                except IndexError:
                    print('Index Error: Data = {}'.format(data))
                print('---- REQUEST END ----')

            # Check to see if dropping the latest candle will help with
            # exchanges which return partial data
            if self.p.drop_newest:
                del data[-1]

            if self._last_ts == 0:
                data0 = data[0]
                while since < data0[0]:
                    if end_date is not None and since > end_date:
                        break
                    ohlv = data0.copy()
                    ohlv[0] = since
                    self._data.append(ohlv)
                    # print('MockData: {}, Adding: {}'.format(self.p.dataname, ohlv))
                    since += interval
                self._last_ts = data0[0]

            with open('../data/' + symbol + '.csv', 'a+', newline='') as f:
                writer = csv.writer(f)

                for ohlcv in data:

                    # for ohlcv in sorted(self.store.fetch_ohlcv(self.p.dataname, timeframe=granularity,
                    #                                           since=since, limit=limit, params=self.p.fetch_ohlcv_params)):

                    if None in ohlcv:
                        continue

                    tstamp = ohlcv[0]

                    # Prevent from loading incomplete data
                    # if tstamp > (time.time() * 1000):
                    #    continue
                    if end_date is not None and tstamp > end_date:
                        break
                    if since is not None and tstamp < since:
                        continue

                    if tstamp > self._last_ts:
                        # if self.p.debug:
                        # print('Data: {}, Adding: {}'.format(self.p.dataname, ohlcv))
                        self._data.append(ohlcv)
                        self._last_ts = tstamp
                        if data_from_ccxt:
                            writer.writerow(ohlcv)

            since = self._last_ts

            data_from_ccxt = True

            if dlen == len(self._data) or (self._last_ts >= end_date if end_date is not None else False):
                break

    def _load_ticks(self):
        if self._last_id is None:
            # first time get the latest trade only
            trades = [self.store.fetch_trades(self.p.dataname)[-1]]
        else:
            trades = self.store.fetch_trades(self.p.dataname)

        for trade in trades:
            trade_id = trade['id']

            if trade_id > self._last_id:
                trade_time = datetime.strptime(trade['datetime'], '%Y-%m-%dT%H:%M:%S.%fZ')
                self._data.append((trade_time, float(trade['price']), float(trade['amount'])))
                self._last_id = trade_id

        try:
            trade = self._data.popleft()
        except IndexError:
            return None  # no data in the queue

        trade_time, price, size = trade

        self.lines.datetime[0] = bt.date2num(trade_time)
        self.lines.open[0] = price
        self.lines.high[0] = price
        self.lines.low[0] = price
        self.lines.close[0] = price
        self.lines.volume[0] = size

        return True

    def _load_ohlcv(self):
        try:
            ohlcv = self._data.popleft()
        except IndexError:
            return None  # no data in the queue

        tstamp, open_, high, low, close, volume = ohlcv

        dtime = datetime.utcfromtimestamp(tstamp // 1000)

        self.lines.datetime[0] = bt.date2num(dtime)
        self.lines.open[0] = open_
        self.lines.high[0] = high
        self.lines.low[0] = low
        self.lines.close[0] = close
        self.lines.volume[0] = volume

        return True

    def haslivedata(self):
        return self._state == self._ST_LIVE and self._data

    def islive(self):
        return not self.p.historical
