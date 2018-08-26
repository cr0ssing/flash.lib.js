const express = require('express')
const app = express()
const http = require('http').Server(app)
const io = require('socket.io')(http)

const PaymentChannel = require('./payment')
const DataChannel = require('./data')
const DataSource = require('./dataSource')

app.use('/', express.static(__dirname + '/public'))

const dataSource = new DataSource()
const price = 2
const args = require('minimist')(process.argv.slice(2))

io.on('connection', async function(socket) {
    console.log('a user connected')

    const dataSender = new DataChannel(socket, dataSource, price)
    const handleNewData = (id) => dataSender.handleId.call(dataSender, id)
    const onClose = () => {
        dataSender.closeDataChannel(async () => {
            dataSource.offNewData(handleNewData)
            dataSender.reset()
            socket.removeAllListeners()
            await init()
        })
    }
    const payment = new PaymentChannel(
        socket, 
        value => dataSender.onPayment.call(dataSender, value), 
        price, 
        onClose)
    
    await init()

    async function init() {
        const seed = args.seed
        const settlement = args.settlement
        await payment.waitForInitiatePayment(settlement, seed, false)
        dataSource.onNewData(handleNewData)

        socket.on('disconnect', function() {
            console.log('user disconnected')
            onClose()
        })
    }
})

http.listen(3000, function() {
    console.log('listening on *:3000')
})