const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
var jwt = require('jsonwebtoken');
var bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// mongoDB connectivity
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.9gt71.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverApi: ServerApiVersion.v1
});

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.PRIVATE_KEY, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: "forbidden access" });
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        client.connect();
        const serviceCollection = client.db("doctorsPortal").collection("services");
        const bookingCollection = client.db("doctorsPortal").collection("bookings");
        const userCollection = client.db("doctorsPortal").collection("user");
        const doctorCollection = client.db("doctorsPortal").collection("doctors");
        console.log('doctors portal connected successfully!');

        const verifyAdmin = async(req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            } else {
                res.status(403).send({ message: "forbidden access" });
            }
        };

        /**
         * API naming convention
         * app.get('/bookings') // get all bookings within a specific collection
         * app.get('/booking/:id') // get a specific booking within a specific collection
         * app.post('/booking') // add a new booking within a specific collection
         * app.patch('/booking/:id') // update a specific booking within a specific collection
         * app.delete('/booking/:id') // delete a specific booking from a specific collection
        */

        // find services
        app.get('/services', async (req, res) => {
            const cursor = serviceCollection.find({}).project({ name: 1 });
            const services = await cursor.toArray();

            res.send(services);
        })

        // add new booking
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatmentName: booking.treatmentName, patientName: booking.patientName, appointmentDate: booking.appointmentDate };
            const existBooking = await bookingCollection.findOne(query);

            if (existBooking) {
                return res.send({ success: false, result: existBooking });
            }

            const result = await bookingCollection.insertOne(booking);

            return res.send({ success: true, result });
        })

        // get all bookings
        app.get('/bookings', verifyJWT, async (req, res) => {
            const patientEmail = req.query.email;
            const decodedEmail = req.decoded.email;

            if (patientEmail === decodedEmail) {
                const query = { patientEmail: patientEmail };
                const bookings = await bookingCollection.find(query).toArray();
                res.send(bookings);
            } else {
                res.status(403).send({ message: "forbidden access" });
            }
        })

        /**
         * find bookings
         * this is not the proper way
         * it's risky but for learning purpose it's okay
         * should have to learn in advance way
         * after learning mongodb properly then do following:
         * use aggregate function, lookup, pipeline, match, group
        */
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            /* step 1: find all services */
            const services = await serviceCollection.find({}).toArray();

            /* step 2: get the booking for that specific date */
            const query = { appointmentDate: date };
            const bookings = await bookingCollection.find(query).toArray();

            /* step 3: for each service find bookings for that service */
            services.forEach(service => {
                // step 1: get service bookings with respect services
                const serviceBookings = bookings.filter(booking => service.name === booking.treatmentName);
                // step 2: make a view of booked time for each service
                const booked = serviceBookings.map(serviceBooking => serviceBooking.appointmentTime);
                service.booked = booked;
                // step 3: display available time exclude booked one
                const available = service.slots.filter(svc => !booked.includes(svc));
                service.slots = available;
            })

            res.send(services);
        })

        // add/update user
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.PRIVATE_KEY, { expiresIn: '1d' });
            res.send({ result, token });
        })

        // add/update admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            const token = jwt.sign({ email: email }, process.env.PRIVATE_KEY, { expiresIn: '1d' });
            res.send({ result, token });
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        // display users
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find({}).toArray();
            res.send(users);
        })

        // add a doctor
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        })

        // display all doctors
        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find({}).toArray();
            res.send(doctors);
        })

        // delete a doctor
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })
    } finally {
        client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Doctors Portal backend started!')
});

app.listen(port, () => {
    console.log(`Doctors Portal backend connected on port ${port}`)
});
