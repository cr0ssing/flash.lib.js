const transfer = require("iota.flash.js/lib/transfer")
const multisig = require("iota.flash.js/lib/multisig")
const InnerFlash = require("iota.flash.js/lib/flash")
const Helpers = require("./functions")

const IOTA = require("async-iota")
const iota = new IOTA()

const States = Object.seal({
    add: (...names) => {
        names.forEach(name => {
            const ordinal = Object.keys(this).length
            this[name] = {name, ordinal}
        })
        return this
    }
}.add("CREATED", "GENERATED_DIGESTS", "WAIT_FOR_DEPOSIT", "READY", "SIGNED_TRANSACTION", "PREPARE_NEW_BRANCH", "CLOSED"))


class Flash {
    constructor(userIndex, seed, settlement, signersCount, security = 2, treeDepth = 4) {
        this.state = States.CREATED
        this.initialized = false
        this.userIndex = userIndex
        this.userSeed = seed
        this.settlement = iota.utils.noChecksum(settlement)
        this.index = 0
        this.security = security
        this.depth = treeDepth
        this.bundles = []
        this.partialDigests = []
        this.signersCount = signersCount
        this.flash = new InnerFlash({
            signersCount,
        }).state
    }

    updateDeposit(deposits) {
        if (this.state == States.WAIT_FOR_DEPOSIT) {
            this.flash.deposit = deposits
            this.flash.balance = this.flash.deposit.reduce((acc, v) => acc + v, 0)
            this.flash.stakes = this.flash.deposit.map(d => d / parseFloat(this.flash.balance))
            this.state = States.READY
            this.initialized = true
        } else {
            throw new Error(`State must be '${States.WAIT_FOR_DEPOSIT.name}' but is '${this.state.name}'.`)
        }
    }

    getTransactableTokens() {
        return this.flash.deposit.reduce((acc, v) => acc + v)
    }

    createDigests(generate = this.depth + 1) {
        const digests = Array(generate).fill()
            .map(e => multisig.getDigest(
                this.userSeed, 
                this.index++, 
                this.security))
        digests.forEach(e => this.partialDigests.push(e))
        this.state = States.GENERATED_DIGESTS
        return digests
    }

    buildNewBranch(allDigests, addressMultisig) {
        if (this.state == States.GENERATED_DIGESTS) {
            const multisigs = this._nestMultisigs(this._createMultisigAddresses(allDigests, allDigests[this.userIndex]))
            addressMultisig.children.push(multisigs[0])
            this.state = States.READY
            return multisigs
        } else {
            throw new Error(`State must be '${States.GENERATED_DIGESTS.name}' but is '${this.state.name}'.`)
        }
    }

    _nestMultisigs(multisigs) {
        // Nest trees
        for (let i = 1; i < multisigs.length; i++) {
            multisigs[i - 1].children.push(multisigs[i])
        }
        return multisigs
    }

    _createMultisigAddresses(allDigests, myDigests = this.partialDigests) {
        const multisigs = myDigests.map((digest, index) => {
            //take nth digest of each user
            const nthDigests = allDigests.map(userDigests => userDigests[index])
            
            // Create address
            const address = multisig.composeAddress(nthDigests)
            // Add key index in
            address.index = digest.index
            // Add the signing index to the object IMPORTANT
            address.signingIndex = this.userIndex * digest.security
            // Get the sum of all digest security to get address security sum
            address.securitySum = nthDigests.reduce((acc, v) => acc + v.security, 0)
            // Add Security
            address.security = digest.security
            return address
        })

        return multisigs
    }

    prepareChannel(allDigests, settlementAddresses) {
        if (!this.initialized) {
            if (this.state == States.GENERATED_DIGESTS) {
                this.multisigs = this._createMultisigAddresses(allDigests)

                // Set remainder address (Same on both users)
                this.flash.remainderAddress = this.multisigs.shift()

                this._nestMultisigs(this.multisigs)

                this.flash.root = this.multisigs.shift()
                this.flash.settlementAddresses = settlementAddresses.map(iota.utils.noChecksum)

                this.state = States.WAIT_FOR_DEPOSIT
            } else {
                throw new Error(`State must be '${States.GENERATED_DIGESTS.name}' but is '${this.state.name}'.`)
            }
        } else {
            throw new Error("Channel is already initialized")
        }
    }

    async createTransaction(amount, settlementAddress, createNewBranch) {
        if (this.state == States.READY) {
            // Create transfer array pointing to other user
            const transfers = [{
                value: amount,
                address: settlementAddress
            }]
            
            // Create TX
            let bundles = await Helpers.createFlashTransaction(this, transfers, this._wrapBranchCallback(createNewBranch))

            // Sign bundles
            const signedBundles = this.signTransaction(bundles, bundles)

            return {bundles, signedBundles}
        } else {
            throw new Error(`State must be '${States.READY.name}' but is '${this.state.name}'.`)
        }
    }

    createCloseTransaction() {
        if (this.state == States.READY) {
            let bundles = Helpers.createCloseTransaction(this, this.flash.settlementAddresses)
            let signedBundles = this.signTransaction(bundles, bundles)
            return {bundles, signedBundles}
        } else {
            throw new Error(`State must be '${States.READY.name}' but is '${this.state.name}'.`)
        }
    }

    _wrapBranchCallback(createNewBranch) { 
        return async (multisig, generate) => {
            this.state = States.PREPARE_NEW_BRANCH
            await createNewBranch(multisig, generate)
        }
    }
    
    signTransaction(bundles, signedBundles) {
        if (this.state == States.READY) {
            // Generate your Singatures
            let mySignatures = Helpers.signTransaction(this, bundles)

            // ADD your signatures to the partially signed bundles
            const result = transfer.appliedSignatures(signedBundles, mySignatures)
            this.state = States.SIGNED_TRANSACTION
            return result
        } else {
            throw new Error(`State must be '${States.READY.name}' but is '${this.state.name}'.`)
        }
    }

    applyTransaction(signedBundles) {
        if (this.state == States.SIGNED_TRANSACTION) {
            Helpers.applyTransfers(this, signedBundles)
            this.bundles = signedBundles
            this.state = States.READY
        } else {
            throw new Error(`State must be '${States.SIGNED_TRANSACTION.name}' but is '${this.state.name}'.`)
        }
    }

    async sendDeposit(amount, seed = this.userSeed, provider = 'https://nodes.devnet.iota.org') {
        if (this.state == States.WAIT_FOR_DEPOSIT) {
            try {
                iota.setSettings({provider})
                await iota.api.getNodeInfo()

                const result = await iota.api.getInputs(seed)
                if (result.totalBalance < amount) {
                    throw new Error("Not enough funds")
                }
                const transfers = [{
                    value: amount,
                    address: this.flash.root.address
                }]
                return await iota.api.sendTransfer(seed, 3, provider == 'https://nodes.devnet.iota.org' ? 9 : 14, transfers)
            } catch (err) {
                throw new Error(err)
            }
        } else {
            throw new Error(`State must be '${States.WAIT_FOR_DEPOSIT.name}' but is '${this.state.name}'.`)
        }
    }

    async checkDeposit(bundleHash, provider = 'https://nodes.devnet.iota.org') {
        try {
            iota.setSettings({provider})
            await iota.api.getNodeInfo()

            const result = await iota.api.findTransactionObjects({
                bundles: [bundleHash]
            })

            const tx = result.find(tx => tx.address == this.flash.root.address)
            if (!tx) {
                throw new Error("Transaction to flash root isn't in bundle")
            }
            return tx.value
        } catch (err) {
            throw new Error(err)
        }
    }

    async attachCurrentBundle(provider = 'https://nodes.devnet.iota.org') {
        if (this.state == States.CLOSED || this.state == States.READY) {
            try {
                iota.setSettings({provider})
                await iota.api.getNodeInfo()

                var bundleTrytes = []
                this.bundles[0].forEach((tx) => bundleTrytes.push(iota.utils.transactionTrytes(tx)))

                const trytes = bundleTrytes.reverse()
                return await iota.api.sendTrytes(trytes, 3,  provider == 'https://nodes.devnet.iota.org' ? 9 : 14)
            } catch (err) {
                throw new Error(err)
            }
        } else {
            throw new Error(`State must be '${States.READY.name}' or '${States.CLOSED.name}' but is '${this.state.name}'.`)
        }
    }

    extractTranfers(bundles, fromIndex) {
        const stakePortion = i => this.flash.deposit[i] / this.flash.deposit.filter((_,i) => i !== fromIndex)
            .reduce((acc, s) => acc + s, 0)
        const flat = a => a.reduce((acc, v) => acc.concat(v), [])
        const bundle = flat(bundles)

        const valueTotal = bundle
            .filter(tx => this.flash.settlementAddresses.includes(tx.address))
            .map(tx => tx.value - (this.flash.outputs[tx.address] || 0)).filter(v => v > 0)
            .reduce((acc, v) => acc + v, 0)

        const sumStakePortion = this.flash.settlementAddresses
            .map((e, i) => ({e, i})) // preserve userIndex
            .filter(({i}) => i !== fromIndex) // don't look for tx' to tx creator
            .map(({i}) => stakePortion(i))
            .reduce((acc, v) => acc + v, 0)

        const total = valueTotal / (this.flash.settlementAddresses.length * sumStakePortion)

        return this.flash.settlementAddresses
            .map((e, i) => ({e, i})) // preserve userIndex
            .filter(({i}) => i !== fromIndex) // don't look for tx' to tx creator
            .filter(({e: addr}) => bundle.find(tx => tx.address === addr))
            .map(({e: addr, i}) => ({current: bundle.find(tx => tx.address === addr), i}))
            .map(({current, i}) => {
                const value = current.value
                let initial = value - total * stakePortion(i) - (this.flash.outputs[current.address] || 0)
                return {
                    value: initial,
                    address: current.address
                }
            })
    }

    getBalances() {
        // add deposits
        let transfers = this.flash.settlementAddresses.map((s, i) => {
            return {address: s, value: this.flash.deposit[i]}
        }).filter(tx => tx.value > 0)

        // add outputs
        transfers = transfers.map(transfer => {
            if (transfer.address in this.flash.outputs) {
                transfer.value += this.flash.outputs[transfer.address]
            }
            return transfer;
        })
        return transfers.map(tx => tx.value)
    }
}

Flash.generateSeed = (length = 81) => {
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ9";
    let retVal = [81];
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal[i] = charset.charAt(Math.floor(Math.random() * n));
    }
    let result = retVal.join("")
    return result;
};

Flash.setErrorMessage = function(error) {
    const message = Object.keys(transfer.TransferErrors).find(e => transfer.TransferErrors[e] == error.message)
    if (message) {
        error.message = message
    }
    return error
}
Flash.States = States
Flash.multisig = multisig

module.exports = Flash