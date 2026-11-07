import test from "node:test";
import assert from "node:assert/strict";
import {amount,assertPayee,getAuth,PayPalSandbox,BASE} from "../scripts/paypal-core.mjs";
test("amounts are server-calculated and exact",()=>{assert.equal(amount(3000),"30.00");assert.equal(amount(2000),"20.00");assert.throws(()=>amount(0));assert.throws(()=>amount(20.5));});
test("rejects wrong or missing merchant payee",()=>{const order={purchase_units:[{payee:{merchant_id:"CONTRACTOR"}}]};assert.equal(assertPayee(order,"CONTRACTOR"),"CONTRACTOR");assert.throws(()=>assertPayee(order,"PLATFORM"));assert.throws(()=>assertPayee({},"CONTRACTOR"));});
test("authorization must be actually returned",()=>{assert.equal(getAuth({purchase_units:[{payments:{authorizations:[{id:"AUTH",status:"CREATED"}]}}]}).id,"AUTH");assert.throws(()=>getAuth({}));});
test("client never makes a production API call", async()=>{const urls=[];const mockedFetch=async(url,options)=>{urls.push(String(url));if(String(url).endsWith("oauth2/token")) return {ok:true,json:async()=>({access_token:"TOKEN"})};return {ok:true,text:async()=>JSON.stringify({id:"ORD",links:[{rel:"approve",href:"https://www.sandbox.paypal.com/checkoutnow?token=ORD"}],purchase_units:[{payee:{merchant_id:"MERCHANT"}}]})};};const client=new PayPalSandbox({clientId:"ID",secret:"SECRET",merchantId:"MERCHANT",fetchImpl:mockedFetch});const order=await client.createItemOrder("paint",3000);assert.equal(order.orderId,"ORD");assert.ok(urls.every(url=>url.startsWith(BASE)));});
test("void must be verified from PayPal after the action", async()=>{const calls=[];const mockedFetch=async(url,options)=>{calls.push({url:String(url),method:options.method});if(String(url).endsWith("oauth2/token")) return {ok:true,json:async()=>({access_token:"TOKEN"})};return {ok:true,text:async()=>options.method==="POST"?"":JSON.stringify({id:"AUTH",status:"VOIDED"})};};const client=new PayPalSandbox({clientId:"ID",secret:"SECRET",merchantId:"MERCHANT",fetchImpl:mockedFetch});const result=await client.void("tile","AUTH");assert.equal(result.status,"VOIDED");assert.equal(calls.filter(x=>x.url.includes("/v2/")).length,2);});
test("sandbox proof models two approvals, independent authorizations, capture and void", async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    const u = String(url); calls.push({url:u, method:opts.method, requestId:opts.headers?.["PayPal-Request-Id"]});
    if (u.endsWith("/oauth2/token")) return {ok:true,json:async()=>({access_token:"TOKEN"})};
    let body;
    if (u.endsWith("/checkout/orders") && opts.method === "POST") {
      const json = JSON.parse(opts.body);const slug=json.purchase_units[0].reference_id;
      body={id:`ORDER-${slug}`,status:"CREATED",purchase_units:[{payee:{merchant_id:"CONTRACTOR"}}],links:[{rel:"approve",href:`https://sandbox.paypal.com/${slug}`}]};
    } else if (u.includes("/checkout/orders/") && u.endsWith("/authorize")) {
      const slug=u.includes("paint")?"paint":"tile";
      body={id:`ORDER-${slug}`,purchase_units:[{payee:{merchant_id:"CONTRACTOR"},payments:{authorizations:[{id:`AUTH-${slug}`,status:"CREATED"}]}}]};
    } else if (u.includes("/checkout/orders/")) body={status:"APPROVED",purchase_units:[{payee:{merchant_id:"CONTRACTOR"}}]};
    else if (u.endsWith("/capture") && opts.method === "POST") body={id:"CAPTURE-paint",status:"PENDING"};
    else if (u.includes("/payments/captures/")) body={id:"CAPTURE-paint",status:"COMPLETED"};
    else if (u.endsWith("/void") && opts.method === "POST") body=null;
    else if (u.includes("/payments/authorizations/") && opts.method === "GET") body={id:"AUTH-tile",status:"VOIDED"};
    else throw new Error(`Unexpected endpoint ${u}`);
    return {ok:true,text:async()=>body?JSON.stringify(body):""};
  };
  const client=new PayPalSandbox({clientId:"ID",secret:"SECRET",merchantId:"CONTRACTOR",fetchImpl:mockFetch});
  const paint=await client.createItemOrder("paint",3000), tile=await client.createItemOrder("tile",2000);
  const pa=await client.approveThenAuthorize("paint",paint), ta=await client.approveThenAuthorize("tile",tile);
  const capture=await client.capture("paint",pa.authorizationId), voided=await client.void("tile",ta.authorizationId);
  assert.equal(paint.orderId,"ORDER-paint");assert.equal(tile.orderId,"ORDER-tile");
  assert.equal(capture.status,"COMPLETED");assert.equal(voided.status,"VOIDED");
  assert.notEqual(pa.authorizationId,ta.authorizationId);
  assert.ok(calls.filter(x=>x.method==="POST"&&x.url.includes("/v2/")).every(x=>x.requestId));
  assert.ok(calls.every(x=>x.url.startsWith(BASE)));
});
test("refuses to authorize a buyer-unapproved order", async () => {
  const mocked=async (url) => String(url).endsWith("/oauth2/token")?{ok:true,json:async()=>({access_token:"T"})}:{ok:true,text:async()=>JSON.stringify({id:"ORD",status:"CREATED",purchase_units:[{payee:{merchant_id:"M"}}]})};
  const api=new PayPalSandbox({clientId:"I",secret:"S",merchantId:"M",fetchImpl:mocked});
  await assert.rejects(()=>api.approveThenAuthorize("paint",{orderId:"ORD"}),/not approved/);
});
