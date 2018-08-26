class DataChannel {
    constructor(socket, dataSource, price) {
        this.socket = socket
        this.price = price
        this.dataSource = dataSource

        this.reset()
    }

    reset() {
        this.samplesLeft = 0
        this.toSend = []
        this.waiting = false
        this.stopping = false
    }

    onPayment(value) {
        this.samplesLeft += value
        const amount = value / this.price
        console.log(`Paid ${amount} samples`)
        this.waiting = false
        this.sendQueued(amount)
        this.handleNotPaid(amount)
    }

    closeDataChannel(removeCallback) {
        const amountLeft = this.samplesLeft / this.price
        console.log(`Scheduled closing data channel after ${amountLeft} samples.`)
        this.stopping = true
        this.removeDataListener = removeCallback
    }

    handleId(id) {
        if (this.samplesLeft < this.price) {
            if (!this.stopping) {
                if (this.waiting == false) {
                    this.toSend = [id]
                    this.waiting = true
                    this.socket.emit('newData', {price: this.price, id}, use => {
                        if (!use) {
                            this.waiting = false
                            this.handleNotPaid(this.toSend.length)
                        }
                    })
                } else {
                    console.log("Queuing", id)
                    this.toSend.push(id)
                }
            } else {
                console.log("Stopped sending data.")
                this.removeDataListener()
            }
        } else {
            this.sendData([id])
        }
    }

    sendQueued(amount) {
        this.sendData(this.toSend.slice(0, amount - 1))
    }

    handleNotPaid(amount) {
        if (this.toSend.length > amount) {
            this.toSend.slice(amount).forEach(id => {
                console.log(id, "was not paid for")
                handleId(id)
            })
        }
        this.toSend = []
    }

    sendData(ids) {
        ids.forEach((id) => {
            this.samplesLeft -= this.price
            this.socket.emit('data', {data: this.dataSource.getData(id), id})
            console.log("Sent data", id)
        })
    }
}

module.exports = DataChannel