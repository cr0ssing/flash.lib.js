// This provides access to basic functions /////
// required for the channels use.          /////
////////////////////////////////////////////////

const IOTACrypto = require("iota.crypto.js")
const transfer = require("iota.flash.js/lib/transfer")
const multisig = require("iota.flash.js/lib/multisig")

const createFlashTransaction = async (user, transfers, createNewBranch) => {
  const multisig = await getMultisig(user, createNewBranch)
  /////////////////////////////////
  /// CONSTRUCT BUNDLES
  // Prepare the transfer.
  const newTransfers = transfer.prepare(
    user.flash.settlementAddresses,
    user.flash.deposit,
    user.userIndex,
    transfers
  )
  return createBundle(user, newTransfers, false, multisig)
}

const createCloseTransaction = (user, settlementAddresses) => {
  const multisig = user.flash.root //await getMultisig(user, createNewBranch)
  /////////////////////////////////
  /// CONSTRUCT BUNDLES
  // Prepare the transfer.
  const newTransfers = transfer.close(settlementAddresses, user.flash.deposit)

  return createBundle(user, newTransfers, true, multisig)
}

const getMultisig = async (user, createNewBranch) => {
  //////////////////////////////
  /// Check for a Branch
  // From the LEAF recurse up the tree to the ROOT
  // and find how many new addresses need to be
  // generated if any.
  let toUse = multisig.updateLeafToRoot(user.flash.root)
  if (toUse.generate != 0) {
    // Tell the server to generate new addresses, attach to the multisig you give
    await createNewBranch(toUse.multisig, toUse.generate)
  }
  return toUse.multisig
} 

const createBundle = (user, transfers, close, multisig) => {
  // Compose the transfer bundles
  const result = transfer.compose(
    user.flash.balance,
    user.flash.deposit,
    user.flash.outputs,
    multisig,
    user.flash.remainderAddress,
    user.flash.transfers,
    transfers,
    close
  )
  return result
}

const signTransaction = (user, bundles) => {
  return transfer.sign(user.flash.root, user.userSeed, bundles)
}

const applyTransfers = (user, bundles) => {
  transfer.applyTransfers(
    user.flash.root,
    user.flash.deposit,
    user.flash.outputs,
    user.flash.remainderAddress,
    user.flash.transfers,
    bundles
  )
  return user
}

module.exports = {
  createFlashTransaction,
  createCloseTransaction,
  signTransaction,
  applyTransfers
}