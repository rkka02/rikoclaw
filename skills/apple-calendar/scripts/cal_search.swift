#!/usr/bin/env swift
import EventKit
import Foundation

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { granted, error in
        if !granted {
            print("ERROR: Calendar access denied. Go to System Settings > Privacy & Security > Calendars and enable access.")
            if let e = error { print("Detail: \(e.localizedDescription)") }
        }
        semaphore.signal()
    }
} else {
    store.requestAccess(to: .event) { granted, error in
        if !granted {
            print("ERROR: Calendar access denied.")
        }
        semaphore.signal()
    }
}
semaphore.wait()

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "help"

switch command {
case "search":
    let keyword = args.count > 2 ? args[2] : ""
    let start = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    let end = Calendar.current.date(byAdding: .year, value: 1, to: Date())!
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate)
    let filtered = events.filter { $0.title?.localizedCaseInsensitiveContains(keyword) == true }
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd HH:mm"
    for e in filtered {
        let startStr = df.string(from: e.startDate)
        let endStr = df.string(from: e.endDate)
        let calName = e.calendar.title
        let allDay = e.isAllDay ? " (all-day)" : ""
        print("\(startStr) ~ \(endStr) | \(e.title ?? "?")\(allDay) [\(calName)]")
    }

case "today":
    let cal = Calendar.current
    let start = cal.startOfDay(for: Date())
    let end = cal.date(byAdding: .day, value: 1, to: start)!
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate)
    let df = DateFormatter()
    df.dateFormat = "HH:mm"
    for e in events {
        let startStr = df.string(from: e.startDate)
        let endStr = df.string(from: e.endDate)
        let calName = e.calendar.title
        let allDay = e.isAllDay ? "(all-day)" : "\(startStr)-\(endStr)"
        print("\(allDay) | \(e.title ?? "?") [\(calName)]")
    }

case "upcoming":
    let days = args.count > 2 ? (Int(args[2]) ?? 7) : 7
    let cal = Calendar.current
    let start = cal.startOfDay(for: Date())
    let end = cal.date(byAdding: .day, value: days, to: start)!
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate)
    let df = DateFormatter()
    df.dateFormat = "MM/dd HH:mm"
    for e in events {
        let startStr = df.string(from: e.startDate)
        let endStr = df.string(from: e.endDate)
        let calName = e.calendar.title
        let allDay = e.isAllDay ? "(all-day)" : "\(startStr)-\(endStr)"
        print("\(allDay) | \(e.title ?? "?") [\(calName)]")
    }

case "calendars":
    let calendars = store.calendars(for: .event)
    for c in calendars {
        print("\(c.title) [\(c.source.title)]")
    }

default:
    print("Calendar CLI (EventKit)")
    print("")
    print("Commands:")
    print("  calendars              List all calendars")
    print("  today                  Today's events")
    print("  upcoming [days]        Upcoming events (default: 7)")
    print("  search \"keyword\"       Search events (past year ~ next year)")
}
