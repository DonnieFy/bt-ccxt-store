// 设置交易对与杠杆
var pair = Symbol+'USDT'
exchange.SetCurrency(Symbol+'_USDT')
exchange.SetContractType("swap")
exchange.IO("api", "POST", "/fapi/v1/leverage", "symbol="+pair+"&leverage="+5+"&timestamp="+Date.now())

//基本的交易精度限制
var price_precision = null
var tick_size = null
var amount_precision = null 
var min_qty = null

var exchange_info = JSON.parse(HttpQuery('https://fapi.binance.com/fapi/v1/exchangeInfo'))
for (var i=0; i<exchange_info.symbols.length; i++){
   if(exchange_info.symbols[i].baseAsset == Symbol){
       tick_size = parseFloat(exchange_info.symbols[i].filters[0].tickSize)
       price_precision = exchange_info.symbols[i].filters[0].tickSize.length > 2 ? exchange_info.symbols[i].filters[0].tickSize.length-2 : 0
       amount_precision = exchange_info.symbols[i].filters[1].stepSize.length > 2 ? exchange_info.symbols[i].filters[1].stepSize.length-2 : 0
       min_qty = parseFloat(exchange_info.symbols[i].filters[1].minQty)
   }
}

//取消全部订单
function CancelPendingOrders() {
    var orders = _C(exchange.GetOrders);
    for (var j = 0; j < orders.length; j++) {
          exchange.CancelOrder(orders[j].Id, orders[j]);}
}

function updatePosition(){//获取持仓,Symbol为交易对，加入交易对参数而不是返回全币种可以减少一次API占用
    position = exchange.IO("api", "GET","/fapi/v2/positionRisk","timestamp="+Date.now()+"&symbol="+Symbol+"USDT")
}
function updateTrades(){//获取最近成交
    trades = exchange.IO("api", "GET","/fapi/v1/trades","limit=200&timestamp="+Date.now()+"&symbol="+Symbol+"USDT")

    var trades = _C(exchange.GetTrades)
        if (self.prices.length == 0) {
            while (trades.length == 0) {
                trades = trades.concat(_C(exchange.GetTrades))
            }
            for (var i = 0; i < 15; i++) {
                self.prices[i] = trades[trades.length - 1].Price
            }
        }
        self.vol = 0.7 * self.vol + 0.3 * _.reduce(trades, function(mem, trade) {
            // Huobi not support trade.Id
            if ((trade.Id > self.lastTradeId) || (trade.Id == 0 && trade.Time > self.lastTradeId)) {
                self.lastTradeId = Math.max(trade.Id == 0 ? trade.Time : trade.Id, self.lastTradeId)
                mem += trade.Amount
            }
            return mem
        }, 0)
}
function updateDepth(){//获取深度
    depth = exchange.IO("IO", "api", "GET","/fapi/v1/depth","timestamp="+Date.now()+"&symbol="+Symbol+"USDT")

    var orderBook = _C(exchange.GetDepth)
        self.orderBook = orderBook
        if (orderBook.Bids.length < 3 || orderBook.Asks.length < 3) {
            return
        }
        self.bidPrice = orderBook.Bids[0].Price * 0.618 + orderBook.Asks[0].Price * 0.382 + 0.01
        self.askPrice = orderBook.Bids[0].Price * 0.382 + orderBook.Asks[0].Price * 0.618 - 0.01
        self.prices.shift()
        self.prices.push(_N((orderBook.Bids[0].Price + orderBook.Asks[0].Price) * 0.35 +
            (orderBook.Bids[1].Price + orderBook.Asks[1].Price) * 0.1 +
            (orderBook.Bids[2].Price + orderBook.Asks[2].Price) * 0.05))
}

function onTick(){
    updateDepth() 
    updateTrades() 
    updatePosition() 
    makeOrder() //计算下单价格、数量并下单
    updateStatus() //更新状态信息
}

//主循环，休眠时间100ms，策略的循环延时通常在在30ms以内。
function main() {
    while(true){
        if(Date.now() - update_loop_time > 100){
            onTick()
            update_loop_time = Date.now()
        }
        Sleep(1)
    }
}