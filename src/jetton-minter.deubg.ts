import {readFile} from "fs/promises";
import {SmartContract, SuccessfulExecutionResult} from "ton-contract-executor";

import {
    Address,
    Cell,
    CellMessage,
    InternalMessage,
    Slice,
    CommonMessageInfo,
    ExternalMessage,
    serializeDict
} from "ton";
import BN from "bn.js";
import {parseActionsList, sliceToAddress267, toUnixTime, sliceToString, addressToSlice264, sliceToAddress} from "./utils";
import { compileFuncToB64 } from "./funcToB64";


const contractAddress = Address.parse('EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t')
const addressA = Address.parseFriendly('kQCLjyIQ9bF5t9h3oczEX3hPVK4tpW2Dqby0eHOH1y5_Nk1x').address;
const addressB = Address.parseFriendly('EQCbPJVt83Noxmg8Qw-Ut8HsZ1lz7lhp4k0v9mBX2BJewhpe').address;



const TRC20_TRANSFER = 0xf8a7ea5;
const SWAP_OUT_SUB_OP = 8;

const OP_MINT = 21;
const BURN_NOTIFICATION = 0x7bdd97de;
const INTERNAL_TRANSFER = 0x178d4519;

export class JettonMinter {
    private constructor(public readonly contract: SmartContract) {}

    async getData() {
        let res = await this.contract.invokeGetMethod('get_wallet_data', []);
        const totalSupply = sliceToString(res.result[0] as BN);
        const wc = res.result[1] as BN;
        const jettonMaster = res.result[2] as Slice;
        const content = res.result[2] as Cell;
        const code = res.result[3] as Cell;

        return  {
            totalSupply,
            wc,
            jettonMaster,
            code
        }
    }


    async init(fakeAddress: Address) {
        let messageBody = new Cell();
        messageBody.bits.writeUint(1, 1);
        let msg = new CommonMessageInfo( { body: new CellMessage(messageBody) });

        let res = await this.contract.sendExternalMessage(new ExternalMessage({
            to: fakeAddress,
            body: msg
        }));
        return res;
    }

    // const body = new Cell();
    // body.bits.writeUint(21, 32); // OP mint
    // body.bits.writeUint(params.queryId || 0, 64); // query_id
    // body.bits.writeAddress(params.destination);
    // body.bits.writeCoins(params.amount); // in Toncoins

    // const transferBody = new Cell(); // internal transfer
    // transferBody.bits.writeUint(0x178d4519, 32); // internal_transfer op
    // transferBody.bits.writeUint(params.queryId || 0, 64);
    // transferBody.bits.writeCoins(params.jettonAmount);
    // transferBody.bits.writeAddress(null); // from_address
    // transferBody.bits.writeAddress(null); // response_address
    // transferBody.bits.writeCoins(new BN(0)); // forward_amount
    // transferBody.bits.writeBit(false); // forward_payload in this slice, not separate cell


    
    async mint(sender: Address, receiver: Address, jettonAmount: BN) {
        let messageBody = new Cell();
        messageBody.bits.writeUint(OP_MINT, 32) // action;
        messageBody.bits.writeUint(OP_MINT, 64) // query;
        messageBody.bits.writeAddress(receiver);
        messageBody.bits.writeCoins(jettonAmount);

        const masterMessage = new Cell();
        masterMessage.bits.writeUint(0x178d4519, 32) // action;
        masterMessage.bits.writeUint(0, 64) // query;
        masterMessage.bits.writeCoins(jettonAmount)
        masterMessage.bits.writeAddress(null) // from_address
        masterMessage.bits.writeAddress(null) // response_address
        masterMessage.bits.writeCoins(new BN(0)); // forward_amount
        masterMessage.bits.writeBit(false); // forward_payload in this slice, not separate cell
        
        messageBody.refs.push(masterMessage)

        let res = await this.contract.sendInternalMessage(new InternalMessage({
            from: sender,
            to: contractAddress,
            value: new BN(10000),
            bounce: false,
            body: new CommonMessageInfo( { body: new CellMessage(messageBody) })
        }))

        let successResult = res as SuccessfulExecutionResult;
        //console.log(res);
        return {
            "exit_code": res.exit_code,
            returnValue: res.result[1] as BN,
            logs: res.logs,
            actions: parseActionsList(successResult.action_list_cell)
        }
    }


    // burn#595f07bc query_id:uint64 amount:(VarUInteger 16) 
    //           response_destination:MsgAddress custom_payload:(Maybe ^Cell)
    //           = InternalMsgBody;
    async receiveBurn(subwalletOwner: Address, sourceWallet: Address, amount: BN) {

        let messageBody = new Cell();
        messageBody.bits.writeUint(BURN_NOTIFICATION, 32) // action
        messageBody.bits.writeUint(1, 64) // query-id
        messageBody.bits.writeCoins(amount) // jetton amount received 
        messageBody.bits.writeAddress(sourceWallet);
        
        
        const removeLiquidityAmount = 300000;
        let customPayload = new Cell();
        customPayload.bits.writeUint(2, 32); // sub op for removing liquidty 
        customPayload.bits.writeCoins(removeLiquidityAmount); // sub op for removing liquidty 

        messageBody.refs.push(customPayload);

        let res = await this.contract.sendInternalMessage(new InternalMessage({
            from: subwalletOwner,
            to: contractAddress,
            value: new BN(10000),
            bounce: false,
            body: new CommonMessageInfo( { body: new CellMessage(messageBody) })
        }))

        let successResult = res as SuccessfulExecutionResult;
        //console.log(res);
        return {
            "exit_code": res.exit_code,
            returnValue: res.result[1] as BN,
            logs: res.logs,
            actions: parseActionsList(successResult.action_list_cell)
        }
    }

    async balanceOf(owner: Address) {
        // let wc = owner.workChain;
        // let address = new BN(owner.hash)

        // let balanceResult = await this.contract.invokeGetMethod('ibalance_of', [
        //     { type: 'int', value: wc.toString(10) },
        //     { type: 'int', value: address.toString(10) },
        // ])
        // //console.log(balanceResult)
        // return (balanceResult.result[0] as BN);
    }

    async getJettonData() {
         let data = await this.contract.invokeGetMethod('get_jetton_data', []);
         const rawAddress = data.result[2] as Slice;

        // const admin = new Address(0, new BN(rawAddress).toBuffer() );
         return {
            totalSupply : data.result[0] as BN,
            mintable : data.result[1] as BN,
            adminAddress: sliceToAddress(rawAddress, true),
            content: data.result[3],
            jettonWalletCode : data.result[4]
         }
    }

    setUnixTime( time: number) {
        this.contract.setUnixTime(time);
    }

    static async create(totalSupply: BN, tokenAdmin: Address, content: string) {
        let msgHexComment = (await readFile('./src/msg_hex_comment.func')).toString('utf-8');
        let jettonMinter = (await readFile('./src/jetton-minter.func')).toString('utf-8');
        let utils = (await readFile('./src/jetton-utils.func')).toString('utf-8');
        let opcodes = (await readFile('./src/op-codes.func')).toString('utf-8');
        let params = (await readFile('./src/params.func')).toString('utf-8');
        let stdlib = (await readFile('./src/stdlib.func')).toString('utf-8');
        
        //based on tonweb example
        //const code = Cell.fromBoc("B5EE9C7241021101000319000114FF00F4A413F4BCF2C80B0102016202030202CC0405001BA0F605DA89A1F401F481F481A8610201D40607020148080900BB0831C02497C138007434C0C05C6C2544D7C0FC02F83E903E900C7E800C5C75C87E800C7E800C00B4C7E08403E29FA954882EA54C4D167C0238208405E3514654882EA58C4CD00CFC02780D60841657C1EF2EA4D67C02B817C12103FCBC2000113E910C1C2EBCB853600201200A0B0201200F1001F500F4CFFE803E90087C007B51343E803E903E90350C144DA8548AB1C17CB8B04A30BFFCB8B0950D109C150804D50500F214013E809633C58073C5B33248B232C044BD003D0032C032483E401C1D3232C0B281F2FFF274013E903D010C7E801DE0063232C1540233C59C3E8085F2DAC4F3208405E351467232C7C6600C02F13B51343E803E903E90350C01F4CFFE80145468017E903E9014D6B1C1551CDB1C150804D50500F214013E809633C58073C5B33248B232C044BD003D0032C0327E401C1D3232C0B281F2FFF274140331C146EC7CB8B0C27E8020822625A020822625A02806A8486544124E17C138C34975C2C070C00930802C200D0E008ECB3F5007FA0222CF165006CF1625FA025003CF16C95005CC07AA0013A08208989680AA008208989680A0A014BCF2E2C504C98040FB001023C85004FA0258CF1601CF16CCC9ED54006C5219A018A182107362D09CC8CB1F5240CB3F5003FA0201CF165007CF16C9718018C8CB0525CF165007FA0216CB6A15CCC971FB00103400828E2A820898968072FB028210D53276DB708010C8CB055008CF165005FA0216CB6A13CB1F13CB3FC972FB0058926C33E25502C85004FA0258CF1601CF16CCC9ED5400DB3B51343E803E903E90350C01F4CFFE803E900C145468549271C17CB8B049F0BFFCB8B0A0822625A02A8005A805AF3CB8B0E0841EF765F7B232C7C572CFD400FE8088B3C58073C5B25C60043232C14933C59C3E80B2DAB33260103EC01004F214013E809633C58073C5B3327B55200083200835C87B51343E803E903E90350C0134C7E08405E3514654882EA0841EF765F784EE84AC7CB8B174CFCC7E800C04E81408F214013E809633C58073C5B3327B55204F664B79");
        const codeB64Str = compileFuncToB64([
            'src/stdlib-jetton-wallet.func', 
            'src/op-codes.func',
            'src/params.func',
            'src/jetton-utils.func',
            'src/jetton-wallet.func',
            'src/msg_hex_comment.func'
        ])
        const code = Cell.fromBoc(codeB64Str);
        
        

        const data = await buildDataCell(totalSupply, tokenAdmin, content, code[0]);
        
        const combinedCode = [ stdlib, opcodes, params, utils, jettonMinter, msgHexComment].join('\n');
        let contract = await SmartContract.fromFuncSource(combinedCode, data, { getMethodsMutate: true })
        const instance = new JettonMinter(contract);
        instance.setUnixTime(toUnixTime(Date.now()));
        return instance;
    }
}



async function buildDataCell(totalSupply: BN, admin: Address, content: string, tokenCode: Cell) {


    // ds~load_coins(), ;; total_supply
    //   ds~load_msg_addr(), ;; admin_address
    //   ds~load_ref(), ;; content
    //   ds~load_ref()  ;; jetton_wallet_code

    const contentCell = new Cell();
    contentCell.bits.writeString(content);

    let dataCell = new Cell()
    dataCell.bits.writeCoins(totalSupply);
    dataCell.bits.writeAddress(admin)                           // name
    dataCell.refs.push(contentCell);
    dataCell.refs.push(tokenCode);
    return dataCell
}


type burnMessage = {
    op: Number,
    queryId: Number,
    amount: BN
    from: Address
};