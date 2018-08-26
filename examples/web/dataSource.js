const EventEmitter = require('events')

class DataSource {
    constructor() {
        this.lastId = -1
        this.data = {}
        this.eventEmitter = new EventEmitter()

        setInterval(() => {
            this.lastId++
            this.data[this.lastId] = {
                x: Date.now(),
                y: Math.floor((Math.random() * 10) + 1)
            }
            this.eventEmitter.emit('data', this.lastId)
        }, 2000)
    }

    getData(id) {
        return this.data[id]
    }

    onNewData(callback) {
        this.eventEmitter.on('data', callback)
    }

    offNewData(callback) {
        this.eventEmitter.removeListener('data', callback)
    }
}

module.exports = DataSource