/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cu = Components.utils;
const Ci = Components.interfaces;
const Cr = Components.results;

const EXPORTED_SYMBOLS = ["ContactDBA"];

Cu.import("resource://gre/modules/commonjs/promise/core.js");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://ensemble/Contact.jsm");

const kCreateContact =
  "INSERT INTO contacts (" +
    "id, attributes, popularity, display_name_family_given," +
    "display_name_given_family" +
  ") VALUES (" +
    ":id, :attributes, :popularity, :display_name_family_given, " +
    ":display_name_given_family" +
  ")";

const kCreateContactData =
  "INSERT INTO contact_data (" +
    "id, contact_id, data1, data2, data3, field_type" +
  ") VALUES (" +
    ":id, :contact_id, :data1, :data2, :data3, :field_type" +
  ")";

/**
 * ContactDBA is the abstraction layer between Contacts (Contact.jsm) and
 * SQLiteContactStore.jsm. This layer takes care of forming and
 * executing the SQLite statements that get run by SQLiteContactStore.
 *
 */
const ContactDBA = {
  _datastore: null,
  _db: null,
  _nextInsertID: {},

  /**
   * Initializes the abstraction layer - unless you're testing / mocking,
   * don't use ContactDBA or Contact without initializing this first!
   *
   * @param aDB the initalized SQLiteContactStore to read from and write to
   * @returns a Promise that resolves once the DBA is initted.
   */
  init: function(aDatastore) {
    // It's OK for the DBAs to reach into SQLiteContactStore like this -
    // these are expected to be tightly coupled.
    this._datastore = aDatastore;
    this._db = this._datastore._db;

    // We need to get the nextInsertIDs for both the contacts
    // table and the contact_data table.
    const kIDManagedTables = ["contacts", "contact_data"];

    let self = this;

    return Task.spawn(function() {
      for (let managedTable of kIDManagedTables) {
        // So this is kind of lame, but we have to do an extra let-binding
        // here, or else the closure for the job gets contaminated with
        // subsequent iterations. Grrr...
        let tableName = managedTable;
        // For each table that uses IDs, schedule a job to calculate the next
        // inserted ID value.
        let nextId = yield self._getNextInsertID(tableName);
        self._nextInsertID[tableName] = nextId;
      }
    });
  },

  _getNextInsertID: function(aTableName) {
    // I'm not dealing with user input, so I'm not worried about
    // SQL injection here - plus, it doesn't appear as if mozStorage
    // will let me bind a table name as a parameter anyway.
    let self = this;
    return Task.spawn(function() {
      let rows = yield self._db.execute("SELECT MAX(id) AS max from " + aTableName);
      let max = rows[0].getResultByName("max");
      if (max === null) {
        throw new Task.Result(1);
      }
      throw new Task.Result(max + 1);
    });
  },

  /**
   * Shuts this abstraction layer down, finalizes any statements, frees
   * memory, etc.
   *
   * @returns a Promise that is resolved upon completion.
   */
  uninit: function() {
    return Promise.resolve();
  },

  createContact: function(aContact) {
    let self = this;
    return Task.spawn(function() {
      dump("\n Creating contact row\n");
      let contactID = yield self._createContactRow(aContact);
      dump("\nDone! Id = " + contactID + " - Creating rows\n");
      yield self._createContactDataRows(contactID, aContact);
      dump("\nDone!\n");
      throw new Task.Result(contactID);
    });
  },

  _createContactRow: function(aContact) {
    let self = this;
    return Task.spawn(function() {
      // The new row will have the ID we're storing in _nextInsertID.contacts.
      let contactID = self._nextInsertID.contacts;
      yield self._db.executeTransaction(function(aConn) {
        yield aConn.executeCached(kCreateContact, {
          id: contactID,
          attributes: JSON.stringify(aContact),
          popularity: aContact.get("popularity"),
          display_name_family_given: "", // TODO
          display_name_given_family: "", // TODO
        });
        self._nextInsertID.contacts++;
      });
      throw new Task.Result(contactID);
    });
  },

  _createContactDataRows: function(aContactID, aContact) {
    let self = this;
    return Task.spawn(function() {
      // We'll start simple - we'll just store the name.
      let dataID = self._nextInsertID.contact_data;
      yield self._db.executeTransaction(function(aConn) {
        dump("\nAbout to execute a transation, yo: " + kCreateContactData + " - id: " + dataID + " and contact_id: " + aContactID + " name: " + aContact.get("name"));
        yield aConn.executeCached(kCreateContactData, {
          id: dataID,
          contact_id: aContactID,
          field_type: "name",
          data1: aContact.fields.get("name"), // Busted.
          data2: "",
          data3: ""
        });
        self._nextInsertID.contact_data++;
      });
    });
  }
};
