const Flash = require('./flash');

(async () => {
    const security = 2
    const depth = 3

    const seed = "USERONESEEDWITHIOTASINTESTNET"
    const settlementAddress = "USERONESETTLEMENTADDRESS"
    const one = new Flash(0, seed, settlementAddress, 2, security, depth)

    const twoSeed = "USERTWOSEEDWITHIOTASINTESTNET"
    const twoSettlement = "USERTWOSETTLEMENTADDRESS"
    const two = new Flash(1, twoSeed, twoSettlement, 2, security, depth)

    const users = [one, two]

    const allDigests = users.map(u => u.createDigests())
    users.forEach(u => {
        u.prepareChannel(allDigests, users.map(u => u.settlement))
    })
    try {
        // Actually transfering funds into the channel root address
        const bundle = await one.sendDeposit(50)
        const hash = bundle[0].bundle
        console.log("Bundle hash one:", hash)
        const value = await two.checkDeposit(hash)

        const twoBundle = await two.sendDeposit(value)
        two.updateDeposit([value, value])

        const twoHash = twoBundle[0].bundle
        console.log("Bundle hash two:", twoHash)
        const twoValue = await one.checkDeposit(twoHash)
        one.updateDeposit([value, twoValue])

        const p = a => ({
            address: a.address, 
            children: a.children.map(c => c.address)
        })
        console.log("Remainder:", p(one.flash.remainderAddress))
        console.log("Root:", p(one.flash.root))

        console.log("Channel set up!")

        ////// MAKE TRANSACTIONS //////
        await transfer(one, two, 10)
        await transfer(one, two, 4)
        await transfer(two, one, 10)

        console.log("Closing channel...");
        ({bundles, signedBundles} = one.createCloseTransaction())
        signedBundles = two.signTransaction(bundles, signedBundles)
        users.forEach(u => u.applyTransaction(signedBundles))

        console.log("Channel Closed")
        console.log("Final Bundle to be attached:")
        console.log(prettyPrint(signedBundles.reduce((acc, v) => acc.concat(v), [])))

        console.log("Attaching bundle...")
        await one.attachCurrentBundle()
        console.log("Success!")
    } catch(err) {
        console.error("Transaction failed:", Flash.setErrorMessage(err))
    }
    
    function prettyPrint(signedBundles) {
        return {
            bundle: signedBundles[0].bundle,
            transactions: signedBundles.map(e => `${e.address}: ${e.value}`)
        }
    }

    async function createNewBranch(address, amount) {
        console.log(`Creating ${amount} new multisigs...`)
        const allDigests = users.map(u => u.createDigests(amount))
        users.forEach(u => {
            const ma = Flash.multisig.getMultisig(u.flash.root, address.address)
            u.buildNewBranch(allDigests, ma)
        })
        console.log("Created new branch for", address.address)
        print(two.flash.root, 0)
    }

    async function transfer(from, to, amount) {
        console.log("Transactable tokens:", one.getTransactableTokens())
        console.log(`Sending ${amount} tokens from ${from.userIndex} to ${to.userIndex}...`)
        try {
            let {bundles, signedBundles} = await from.createTransaction(amount, to.settlement, createNewBranch)
            console.log(to.extractTranfers(bundles, from.userIndex))
            
            signedBundles = to.signTransaction(bundles, signedBundles)
            users.forEach(u => u.applyTransaction(signedBundles))
            console.log("Transaction Applied!")
            console.log("Deposit:", from.flash.deposit)
            console.log("Balances:", from.getBalances())
        } catch(err) {
            console.error("Transaction failed:", Flash.setErrorMessage(err))
        }
    }
})()