(async () => {
    const Flash = require("./flash")

    const oneSeed =
    "USERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSER"
    const oneSettlement =
    "USERONE9ADDRESS9USERONE9ADDRESS9USERONE9ADDRESS9USERONE9ADDRESS9USERONE9ADDRESS9U"
    const twoSeed =
    "USERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSER"
    const twoSettlement =
    "USERTWO9ADDRESS9USERTWO9ADDRESS9USERTWO9ADDRESS9USERTWO9ADDRESS9USERTWO9ADDRESS9U"

    const security = 2
    const depth = 2
    const one = new Flash(0, oneSeed, oneSettlement, 2, security, depth)
    const two = new Flash(1, twoSeed, twoSettlement, 2, security, depth)
    const users = [one, two]

    const allDigests = users.map(u => u.createDigests())
    users.forEach(u => {
        u.prepareChannel(allDigests, users.map(u => u.settlement))
    })

    users.forEach(u => u.updateDeposit([1000, 1000]))

    const p = a => ({
        address: a.address, 
        children: a.children.map(c => c.address)
    })
    console.log("Remainder:", p(one.flash.remainderAddress))
    console.log("Root:", p(one.flash.root))

    const print = (t, d) => {
        let result = ""
        for (let i = 0; i < d; i++) {
            result += "  "
        }
        console.log(result + t.address)
        t.children.forEach(c => print(c, d + 1))
    }
    print(one.flash.root, 0)

    console.log("Channel set up!")

    ////// MAKE TRANSACTIONS //////
    for (let j = 0; j < 2; j++) {
        console.log("Transaction", j)
        await transfer(one, two, 20)
    }

    // console.log(prettyPrint(one.bundles))
    
    console.log("Closing channel...")
    try {
        ({bundles, signedBundles} = one.createCloseTransaction())
        signedBundles = two.signTransaction(bundles, signedBundles)
        users.forEach(u => u.applyTransaction(signedBundles))

        console.log("Channel Closed")
        console.log("Final Bundle to be attached: ")
        console.log(prettyPrint(signedBundles.reduce((acc, v) => acc.concat(v), [])))

    } catch(err) {
        console.error("Transaction failed:", Flash.setErrorMessage(err))
    }
    
    function prettyPrint(signedBundles) {
        return signedBundles.map(e => `${e.address}: ${e.value}`)
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
            // signedBundles.forEach(b => console.log(prettyPrint(b)))
        } catch(err) {
            console.error("Transaction failed:", Flash.setErrorMessage(err))
        }
    }
})()