import json
import requests

SUBLIMATION_FALLBACK_K = {
    6: 3900,  # Carbon
}


def build_cosmic_dataset():
    print("Fetching cosmic elemental data...")

    url = "https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json"
    response = requests.get(url, timeout=30)

    if response.status_code != 200:
        print("Failed to fetch data. Check your connection.")
        return

    raw_data = response.json().get("elements", [])
    cosmic_elements = {}

    for el in raw_data:
        number = el["number"]
        if not (1 <= number <= 118):
            continue
        atomic_mass = el.get("atomic_mass")
        mass = "Unknown"
        if atomic_mass is not None:
            try:
                mass = round(float(atomic_mass), 3)
            except (TypeError, ValueError):
                mass = str(atomic_mass)

        cosmic_elements[number] = {
            "number": number,
            "symbol": el["symbol"],
            "name": el["name"],
            "mass": mass,
            "group": el.get("group", "-"),
            "period": el["period"],
            "type": str(el.get("category", "Unknown")).capitalize(),
            "fact": el.get("summary", "No summary available."),
            "melt": el.get("melt", "Unknown"),
            "boil": el.get("boil", "Unknown"),
            "sublimation": SUBLIMATION_FALLBACK_K.get(number),
            "discovered_by": el.get("discovered_by", "Ancient times"),
            "phase": el.get("phase", "Unknown"),
        }

    with open("elements.json", "w", encoding="utf-8") as f:
        json.dump(cosmic_elements, f, indent=2)

    print(f"Success! elements.json created with {len(cosmic_elements)} elements.")


if __name__ == "__main__":
    build_cosmic_dataset()
