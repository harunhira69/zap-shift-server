require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

// firebase admin sdk
let admin;
if (process.env.FIREBASE_PRIVATE_KEY) {
  admin = require("firebase-admin");

  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  };

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.warn("Firebase initialization failed:", error.message);
  }
}


const app = express()
require('dotenv').config();
const port = process.env.PORT || 3000
const crypto = require("crypto");

function createTrackingId() {
  const prefix = "PCL";
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${timestamp}-${randomStr}`;
}
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.irtmkrl.mongodb.net/?appName=Cluster0`;
// middleware
app.use(express.json());
app.use(cors());

const verifyFbToken = async(req,res,next)=>{
  const token = req.headers.authorization;
  // console.log('Firebase token',token);
  if(!token){
    return res.status(401).send({message:'unauthorized access'})
  }
  try{
    const idToken = token.split(' ')[1];
    const decode = await admin.auth().verifyIdToken(idToken);
    console.log("Decoded token",decode);
    req.decoded_email = decode.email;

  }
  catch(err){
    return res.status(401).send({message:'unauthorized access'});

  }
  next();
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});





app.get('/', (req, res) => {
  res.send('zapshift is running')
})

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('zap_shift_db');
    const userCollection = db.collection('users')
    const percelCollection = db.collection('parcels')
    const paymentCollection = db.collection('payments')
    const riderCollection = db.collection('riders')

    // parcel api
    app.get('/parcel', async (req, res) => {
      const query = {};
      const { email } = req.query

      if (email) {
        query.senderEmail = email;

      }
      const option = { sort: { createdAt: -1 } }
      const cursor = percelCollection.find(query, option);
      const result = await cursor.toArray();
      res.send(result)


    })

    app.post('/parcel', async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await percelCollection.insertOne(parcel);
      res.send(result)
    });

    app.delete('/parcel/:id', async (req, res) => {
      const id = req.params.id;
      console.log("Deleting parcel:", id);

      const query = { _id: new ObjectId(id) };
      const result = await percelCollection.deleteOne(query);
      res.send(result);
    });

    app.get('/parcel/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await percelCollection.findOne(query);
      res.send(result);


    })
    app.post('/checkout-session', async(req,res)=>{
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost)*100;
      const session = await stripe.checkout.sessions.create({
       line_items: [
      {
   
        price_data:{
          currency:'USD',
          product_data:{
                name: `Please pay for parcel ${paymentInfo.parcelName}`,
          },
     
          unit_amount:amount,

        }
,
        quantity: 1,
      },
    ],
    mode: 'payment',
    metadata: {
        parcelId: paymentInfo.parcelId,
        parcelName:paymentInfo.parcelName,
      },
    customer_email:paymentInfo.senderEmail,
 success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,

      });
      res.send({url:session.url})
    })
    // old
 app.post('/create-checkout-session', async (req, res) => {
  try {
    const paymentInfo = req.body;
    const amount = parseInt(paymentInfo.cost) * 100;

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'USD',
            unit_amount: amount,
            product_data: {
              name: paymentInfo.parcelName,
            },
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: paymentInfo.senderEmail,
      metadata: {
        parcelId: paymentInfo.parcelId,
      },
      success_url: `${process.env.SITE_DOMAIN}dashboard/payment-success`,
      cancel_url: `${process.env.SITE_DOMAIN}dashboard/payment-cancelled`,
    });

    res.send({ url: session.url });

  } catch (error) {
    console.error("Stripe Error:", error);
    res.status(400).send({ error: error.message });
  }
});

app.patch('/verify-success-payment', async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).send({ error: "session_id missing" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(session)

    console.log("Session retrieved:", session);
    const trackingId = createTrackingId();

    if (session.payment_status === "paid") {
      const id = session.metadata.parcelId;

      const query = { _id: new ObjectId(id) };
      const update = {
        $set: {
          status: "paid",
          trackingId:trackingId,
        }
      };

      const result = await percelCollection.updateOne(query, update);
      const payment = {
        amount:session.amount_total/100,
        currency:session.currency,
        customerEmail:session.customer_email,
        parcelId:session.metadata.parcelId,
        parcelName:session.metadata.parcelName,
        transaction:session.payment_intent,
        paymentStatus: session.payment_status,
        createdAt:new Date(),
        trackingId: trackingId
      }
      if(payment.paymentStatus==='paid'){
  const resultPayment = await paymentCollection.insertOne(payment);
  return res.send({success:true,
    modifyParcel:result,
    transactionId:session.payment_intent,
    paymentInfo:resultPayment,
    trackingId:trackingId})
      }
    }

    return res.send({ success: false });

  } catch (error) {
    console.error("Verify Error:", error);
    return res.status(500).send({ error: error.message });
  }
});

app.get('/payment', verifyFbToken, async (req,res)=>{
  const email = req.query.email;
  const query = {};
  if(email){
    query.customerEmail = email;
    if(email !==req.decoded_email){
      return res.status(403).send({message:'forbidden access'})
    }
  }
  const cursor = paymentCollection.find(query).sort({createdAt:-1});
  const result = await cursor.toArray();
  res.send(result)
})



app.post('/users',async(req,res)=>{
  const user = req.body;
  user.createdAt = new Date();
  user.role = 'user';
  const userExist = await userCollection.findOne({email:user.email});
  if(userExist){
    return res.send({message:'User already exist'})
  }
  const result = await userCollection.insertOne(user);
  res.send(result);

})

app.get('/users', async(req,res)=>{
  const cursor = userCollection.find();
const result = await cursor.toArray();
res.send(result)

})


// rider related api
app.post('/riders',async(req,res)=>{
  const rider = req.body;
  rider.createdAt =  new Date();
  rider.status = 'pending';
  const result = await riderCollection.insertOne(rider);
  res.send(result);
});

app.get('/riders',async(req,res)=>{
  const query = {};
  if(req.query.status){
    query.status = req.query.status;
  }
  const cursor = riderCollection.find(query);
  const result = await cursor.toArray();
  res.send(result);

})


app.patch('/riders/:id',async(req,res)=>{
  const id = req.params.id;
  const status = req.body.status;
  const query = {_id: new ObjectId(id)};
  const updateDoc = {
    $set:{
      status:status
    }
  }
  const result = await riderCollection.updateOne(query,updateDoc);
  res.send(result);
})



app.delete('/riders/:id',async(req,res)=>{
  const id = req.params.id;
  const query = {_id:new ObjectId(id)};
  const result = await riderCollection.deleteOne(query);
  res.send(result)
  
})









    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);





app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
