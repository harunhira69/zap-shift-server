const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express()
require('dotenv').config();
const port = process.env.PORT||3000
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.irtmkrl.mongodb.net/?appName=Cluster0`;

app.use(express.json());
app.use(cors());

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
    const percelCollection = db.collection('parcels')

    // parcel api
    app.get('/parcel',async(req,res)=>{
      const query ={};
      const {email} = req.query

        if(email){
        query.senderEmail = email;
        
      }
      const option = {sort:{createdAt:-1}}
      const cursor = percelCollection.find(query,option);
      const result = await cursor.toArray();
      res.send(result)
    

    })

    app.post('/parcel',async(req,res)=>{
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
