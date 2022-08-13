const express = require("express");
const { Client } = require("@notionhq/client");
const dotenv = require("dotenv");
const formidable = require("express-formidable");
const { parseISO, format, formatISO } = require("date-fns");

dotenv.config();

const app = express();

app.use(formidable());

app.use(function (req, res, next) {
  // Website you wish to allow to connect
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://gleeful-biscuit-12259f.netlify.app"
    // "http://localhost:8100"
  );

  // Request methods you wish to allow
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );

  // Request headers you wish to allow
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-Requested-With,content-type"
  );

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader("Access-Control-Allow-Credentials", false);

  // Pass to next layer of middleware
  next();
});

const port = process.env.PORT || 3000;

function getNotionClient(token) {
  const client = new Client({ auth: token });
  return client;
}

async function getDatabaseIdByName(dbName, client) {
  const response = await client
    .search({
      query: dbName,
      filter: { property: "object", value: "database" },
    })
    .catch(() => null);
  return response?.results[0]?.id;
}

async function getExpenses(client) {
  const database_id = await getDatabaseIdByName("Expenses", client).catch(
    () => null
  );
  if (!database_id) {
    return;
  }

  const queryProps = ["Description", "Date", "Amount"];
  const filter = {
    and: [
      {
        property: "Status",
        select: {
          equals: "Pending",
        },
      },
      {
        property: "Date",
        date: {
          on_or_before: formatISO(new Date(), { representation: "date" }),
        },
      },
    ],
  };

  let response = await client.databases
    .query({
      database_id,
      filter,
    })
    .catch(() => null);

  if (!response?.results?.length) {
    response = { pages: [] };
  } else {
    const pages = [];
    for (const entry of response.results) {
      const properties = {};
      for (const property in entry.properties) {
        if (queryProps.includes(property)) {
          const propId = entry.properties[property].id;

          properties[property] = entry.properties[property];

          let value = await getPropertyValue(entry.id, propId, client);
          switch (property) {
            case "Date":
              const dateStr = value.date.start;
              value = new Date(dateStr);
              break;
            case "Amount":
              value = value.number;
              break;
            case "Description":
              value = value.results[0]?.title?.text?.content;
              break;
            default:
              value = "";
              //   value = undefined;
              break;
          }

          properties[property].value = value;
        }
      }
      pages.push({ ...properties, id: entry.id });
    }
    response = { pages };
  }

  return response;
}

async function getExpectedBalance(client) {
  const database_id = await getDatabaseIdByName("Balance", client).catch(
    () => null
  );
  if (!database_id) {
    return;
  }

  // const queryProps = ["Description", "Date", "Amount"];
  const filter = {
    and: [
      {
        property: "Time Period",
        title: {
          equals: format(new Date(), "MMMM"),
        },
      },
    ],
  };

  let response = await client.databases
    .query({
      database_id,
      filter,
    })
    .catch(() => null);

  if (!response?.results?.length) return;

  const page_id = response.results[0].id;
  const expectedBalance = response.results[0].properties["Expected Balance"];
  const value = await getPropertyValue(
    page_id,
    expectedBalance.id,
    client
  ).catch(() => null);

  if (!value) return;

  expectedBalance.value = value.formula.number;
  return expectedBalance;
}

async function getPropertyValue(page_id, property_id, client) {
  const response = await client.pages.properties.retrieve({
    page_id,
    property_id,
  });
  return response;
}

async function getBalanceIds(page, client) {
  const balanceDbId = await getDatabaseIdByName("Balance", client).catch(
    () => null
  );

  if (!balanceDbId) return;

  const filter = {
    or: [
      {
        property: "Time Period",
        title: {
          equals: format(parseISO(page.date), "MMMM"),
        },
      },
      {
        property: "Time Period",
        title: {
          equals: format(parseISO(page.date), "yyyy"),
        },
      },
    ],
  };

  const response = await client.databases
    .query({
      database_id: balanceDbId,
      filter,
    })
    .catch(() => null);

  if (!response?.results?.length) return;

  const ids = [];

  response.results.forEach((entry) => {
    ids.push({ id: entry.id });
  });

  return ids;
}

app.get("/", async (req, res) => {
  res.send("<h1>Hello World!</h1>");
});

app.get("/expenses", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);
  const response = await getExpenses(client).catch(() => null);
  if (!response) {
    res.status(404).send();
    return;
  }

  res.send(response);
});

app.get("/expected-balance", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);
  const response = await getExpectedBalance(client).catch(() => null);

  if (!response) {
    res.status(404).send();
    return;
  }

  res.send(response);
});

app.get("/expense", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);
  const page_id = req.query.page_id;
  const response = await client.pages
    .update({ page_id, archived: true })
    .catch(() => {
      null;
    });

  if (!response) {
    res.status(500).send({ message: "Something went wrong" });
    return;
  }

  res.send(response);
});

app.get("/complete-expense", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);
  const page_id = req.query.page_id;
  const response = await client.pages
    .update({
      page_id,
      properties: {
        Status: {
          select: {
            name: "Complete",
          },
        },
      },
    })
    .catch((err) => {
      null;
    });

  if (!response) {
    res.status(500).send({ message: "Something went wrong" });
    return;
  }

  res.send(response);
});

app.post("/expense", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);

  const database_id = await getDatabaseIdByName("Expenses", client).catch(
    () => null
  );

  if (!database_id) {
    res.status(500).send({ message: "Something went wrong" });
    return;
  }

  const page = req.fields;

  const balanceRelations = await getBalanceIds(page, client);

  if (!balanceRelations?.length) {
    res.status(500).send({ message: "Something went wrong" });
    return;
  }

  const response = await client.pages
    .create({
      parent: {
        type: "database_id",
        database_id,
      },
      properties: {
        Description: {
          title: [
            {
              text: {
                content: page.description,
              },
            },
          ],
        },
        Date: {
          date: {
            start: page.date,
          },
        },
        Amount: {
          number: parseInt(page.amount),
        },
        Balance: {
          relation: balanceRelations,
        },
        Card: {
          select: {
            name: "Discover it",
          },
        },
        Status: {
          select: {
            name: "Pending",
          },
        },
      },
    })
    .catch((err) => {
      null;
    });

  if (!response) {
    res.status(500).send({ message: "Something went wrong" });
    return;
  }

  res.send({ id: response.id });
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
