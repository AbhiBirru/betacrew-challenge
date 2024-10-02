const net = require("net");
const fs = require("fs");

const HOSTNAME = "localhost";
const PORT = 3000;

const FETCHING = "FETCHING";
const FETCHED = "FETCHED";

let expectedSequence = 1;
let missedSequences = [];
let missedState = FETCHED;
let stockData = [];

const clientSocket = new net.Socket();

function writeToFile(data, filename) {
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFile(filename, jsonData, (err) => {
    if (err) {
      console.error(`Error writing to file: ${err}`);
    } else {
      console.log(`Data written to ${filename}`);
    }
  });
}

function requestPackets(type, sequence = 0) {
  const payload = Buffer.alloc(2);
  payload.writeUInt8(type, 0);
  payload.writeUInt8(sequence, 1);
  clientSocket.write(payload);
}

function fetchAllPackets() {
  connectToServer(() => {
    console.log("Requesting all packets...");
    requestPackets(1);
  });
}

function fetchMissingPackets() {
  connectToServer(() => {
    console.log(`Requesting missing sequences: ${missedSequences}`);
    while (missedSequences.length) {
      const sequence = missedSequences.pop();
      requestPackets(2, sequence);
    }
    closeConnection();
  });
}

function connectToServer(onConnect) {
  clientSocket.connect(PORT, HOSTNAME, () => {
    console.log(`Connected to server at ${HOSTNAME}:${PORT}`);
    if (onConnect) onConnect();
  });
}

function closeConnection() {
  clientSocket.end();
}

function handlePacket(packet) {
  const symbol = packet.toString("ascii", 0, 4);
  const buySellIndicator = packet.toString("ascii", 4, 5);
  const quantity = packet.readUInt32BE(5);
  const price = packet.readUInt32BE(9);
  const packetSequence = packet.readUInt32BE(13);

  return { symbol, buySellIndicator, quantity, price, packetSequence };
}

function processData(data) {
  const packetSize = 17;
  for (let i = 0; i < data.length; i += packetSize) {
    const packet = data.slice(i, i + packetSize);
    const parsedPacket = handlePacket(packet);
    const { packetSequence } = parsedPacket;

    // Handle missed sequences
    if (packetSequence !== expectedSequence) {
      for (let seq = expectedSequence; seq < packetSequence; seq++) {
        missedSequences.push(seq);
        stockData.push(null); // Reserve space for missed sequences
      }
    }

    // Place the packet in the correct spot if fetching missing sequences
    if (missedState === FETCHING) {
      stockData[packetSequence - 1] = parsedPacket;
    } else {
      stockData.push(parsedPacket);
    }

    expectedSequence = packetSequence + 1;
  }
}

function onConnectionClose() {
  console.log("Connection closed.");
  if (missedSequences.length) {
    missedState = FETCHING;
    fetchMissingPackets();
  } else {
    missedState = FETCHED;
    writeToFile(stockData, "stockData.json");
  }
}

function onError(err) {
  console.error(`Socket error: ${err.message}`);
}

clientSocket.on("data", processData);
clientSocket.on("error", onError);
clientSocket.on("close", onConnectionClose);

fetchAllPackets();
