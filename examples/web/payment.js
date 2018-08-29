const Flash = require('flash.lib.js')

class PaymentChannel {
    constructor(socket, onPayment, price, onClose) {
        this.socket = socket
        this.onPayment = onPayment
        this.price = price
        this.onClose = onClose
    }

    waitForInitiatePayment(settlementAddress, seed, activateDepositing = true) {
        const payment = this
        return new Promise((res, rej) => { 
            this.socket.on('createFlash', function({settlement, digests, depth, security}, ack) {
            console.log("Creating flash channel...")

            // use random seed to have new multisig addresses everytime
            const flash = new Flash(0, Flash.generateSeed(), settlementAddress, 2, security, depth)
            payment.flash = flash
            const myDigests = flash.createDigests()
            const allDigests = [myDigests, digests]
            flash.prepareChannel(allDigests, [flash.settlement, settlement])
            
            const min = payment.price * 10 * 2
            const max = payment.price * 500 * 2

            ack({
                digests: myDigests,
                settlement: flash.settlement,
                price: payment.price,
                min,
                max
            })

            payment.socket.on('requestDeposit', async ({value: myValue}, ack) => {
                if (myValue >= min && myValue <= max) {
                    try {
                        console.log("Sending deposit...")
                        const myHash = activateDepositing ? (await flash.sendDeposit(myValue, seed))[0].bundle : ''
                        ack({hash: myHash, value: myValue})

                        console.log("Wait for client deposit...")
                        payment.socket.on('sentDeposit', async ({hash, value}, ack) => {
                            if ((hash != myHash) || !activateDepositing) {
                                const deposit = activateDepositing ? await flash.checkDeposit(hash) : value
                                if (deposit == value && deposit >= myValue) {
                                    flash.updateDeposit([myValue, deposit])

                                    ack(true)
                                    payment.setupSocket(flash)
                                    console.log("Server set up!")
                                    res()
                                } else {
                                    console.error("Client sent false amount")
                                    ack({error: true})
                                    rej()
                                }
                            } else {
                                console.log("Client sent bundle hash of bundle that server created")
                                ack({error: true})
                                rej()
                            }
                        })
                    } catch(err) {
                        console.log("Sending deposit failed", err)
                        ack({error: true})
                        rej()
                    }
                } else {
                    ack({error: true})
                    rej()
                }
            })
        })})
    }

    initiatePayment(settlementAddress, seed = Flash.generateSeed()) {
        const payment = this

        const flash = new Flash(0, seed, settlementAddress, 2, 2, 6)
        this.flash = flash
        const digests = flash.createDigests()
        //TODO before sending deposit actual funds to root address

        return new Promise((res, reg) => {
            this.socket.emit('createFlash', {
                settlement: flash.settlement, 
                digests, 
                depth: flash.depth, 
                security: flash.security,
                price: this.price
            }, ({digests: otherDigests, settlement}) => {
                if (flash.state == Flash.States.GENERATED_DIGESTS) {
                    const allDigests = [digests, otherDigests]
                    flash.prepareChannel(allDigests, [flash.settlement, settlement])
                    //TODO dont hardcode
                    flash.updateDeposit([1000, 1000])
                    console.log("Server set up!")
                    
                    payment.setupSocket(flash)
                    res()
                } else {
                    console.log("Can't initialize flash. State is", flash.state)
                    rej()
                }
            })
        })
    }

    setupSocket(flash) {
        ///////////////////////
        // Ready to send data
        //
        // Setup socket listeners
        ///////////////////////
        this.socket.on('createNewBranch', ({digests, address}, ack) => {
            if (flash.state == Flash.States.READY) {
                flash.state = Flash.States.PREPARE_NEW_BRANCH
                const addressMultisig = Flash.multisig.getMultisig(flash.flash.root, address)
                const myDigests = flash.createDigests(digests.length)
                flash.buildNewBranch([myDigests, digests], addressMultisig)
                ack(myDigests)
            } else {
                console.log("Can't create new branch. State is", flash.state)
                ack(false)
            }
        })

        function createNewBranch(address, amount) {
            return new Promise((res, rej) => {
                console.log(`Creating ${amount} new multisigs...`)
                const myDigests = flash.createDigests(amount)
                this.socket.emit('createNewBranch', ({digests: myDigests, address: address.address}), (digests) => {
                    flash.createNewBranch([myDigests, digests], address)
                    res()
                })
            })
        }

        this.socket.on('createdTransaction', ({bundles, signedBundles, close}) => {
            try {
                if (!close) {
                    const transfers = flash.extractTranfers(bundles, 1)
                    const tx = transfers.find(tx => tx.value >= this.price && tx.address == flash.settlement)
                    if (tx) {
                        signedBundles = flash.signTransaction(bundles, signedBundles)
                        console.log("Signed transaction")
                        flash.applyTransaction(signedBundles)
                    
                        console.log("Applied transaction. New Balance:", flash.getBalances()[0])
                        this.socket.emit('signedTransaction', {signedBundles, close})

                        this.onPayment(tx.value)
                    } else {
                        console.error("No transaction with right price is included in bundle:", transfers)
                    }
                } else {
                    signedBundles = flash.signTransaction(bundles, signedBundles)
                    console.log("Signed transaction")
                    flash.applyTransaction(signedBundles)
                    flash.state = Flash.States.CLOSED

                    this.socket.emit('signedTransaction', {signedBundles, close})
                    const finalBalances = flash.flash.settlementAddresses
                        .map(a => signedBundles.reduce((acc, v) => acc.concat(v), [])
                            .find(tx => tx.address == a))
                        .filter(t => t).map(t => t.value)
    
                    console.log("Applied transaction. New Balance:", finalBalances[0])
                    console.log("Closed payment channel.")
                    this.onClose()
                }
            } catch(err) {
                console.error("Transaction failed:", Flash.setErrorMessage(err))
            }
        })
    }
}

module.exports = PaymentChannel