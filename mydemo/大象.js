
var Counter = {
    i: 0,
    w: 0,
    f: 0
};

// Variables
var InitAccount = null;

function CancelAll() {
    while (true) {
        var orders = _C(exchange.GetOrders);
        if (orders.length == 0) {
            break;
        }
        for (var i = 0; i < orders.length; i++) {
            exchange.CancelOrder(orders[i].Id);
        }
        Sleep(Interval);
    }
}

function updateStatus(msg) {
    LogStatus("调戏次数:", Counter.i, "成功:", Counter.w, "失败:", Counter.f, "\n"+msg+"#0000ff\n"+new Date());
}

function main() {
    if (DisableLog) {
        EnableLog(false);
    }
    CancelAll();
    InitAccount = _C(exchange.GetAccount);
    Log(InitAccount);
    var i = 0;
    var locks = 0;
    while (true) {
        Sleep(Interval);
        var depth = _C(exchange.GetDepth);
        if (depth.Asks.length === 0 || depth.Bids.length === 0) {
            continue;
        }
        updateStatus("搜索大象中.... 买一: " + depth.Bids[0].Price + ",  卖一:" + depth.Asks[0].Price + ", 锁定次数: " + locks);
        var askPrice = 0;
        for (i = 0; i < depth.Asks.length; i++) {
            if (depth.Asks[i].Amount >= Lot) {
                askPrice = depth.Asks[i].Price;
                break;
            }
        }
        if (askPrice === 0) {
            continue;
        }
        var elephant = null;
        // skip Bids[0]
        for (i = 1; i < depth.Bids.length; i++) {
            if ((askPrice - depth.Bids[i].Price) > ElephantSpace) {
                break;
            }
            if (depth.Bids[i].Amount >= ElephantAmount) {
                elephant = depth.Bids[i];
                break;
            }
        }

        if (!elephant) {
            locks = 0;
            continue;
        }
        locks++;
        if (locks < LockCount) {
            continue;
        }
        locks = 0;

        updateStatus("调戏大象中....大象在第" + i + "档, " + JSON.stringify(elephant));
        exchange.Buy(elephant.Price + PennyTick, Lot, "Bids[" + i + "]", elephant);
        var ts = new Date().getTime();
        while (true) {
            Sleep(CheckInterval);
            var orders = _C(exchange.GetOrders);
            if (orders.length == 0) {
                break;
            }
            if ((new Date().getTime() - ts) > WaitInterval) {
                for (var i = 0; i < orders.length; i++) {
                    exchange.CancelOrder(orders[i].Id);
                }
            }
        }
        var account = _C(exchange.GetAccount);
        var opAmount = _N(account.Stocks - InitAccount.Stocks);
        if (opAmount < 0.001) {
            Counter.f++;
            Counter.i++;
            continue;
        }
        updateStatus("买单得手: " + opAmount +", 开始出手...");
        exchange.Sell(elephant.Price + (PennyTick * ProfitTick), opAmount);
        var success = true;
        while (true) {
            var depth = _C(exchange.GetDepth);
            if (depth.Bids.length > 0 && depth.Bids[0].Price <= (elephant.Price-(STTick*PennyTick))) {
                success = false;
                updateStatus("没有得手, 开始止损, 当前买一: " + depth.Bids[0].Price);
                CancelAll();
                account = _C(exchange.GetAccount);
                var opAmount = _N(account.Stocks - InitAccount.Stocks);
                if (opAmount < 0.001) {
                    break;
                }
                exchange.Sell(depth.Bids[0].Price, opAmount);
            }
            var orders = _C(exchange.GetOrders);
            if (orders.length === 0) {
                break;
            }
            Sleep(CheckInterval);
        }
        if (success) {
            Counter.w++;
        } else {
            Counter.f++;
        }
        Counter.i++;
        var account = _C(exchange.GetAccount);
        LogProfit(account.Balance - InitAccount.Balance, account);
    }
}