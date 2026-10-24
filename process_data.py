import os
import json
import numpy as np
import xarray as xr

# Physical Constants calibrated for Ghana's equatorial coast (~5° N)
LATITUDE = 5.0  
OMEGA = 7.2921e-5  
RHO_WATER = 1025.0 
F_CORIOLIS = 2 * OMEGA * np.sin(np.radians(LATITUDE)) 

def calculate_indices():
    physics_path = "./raw_data/ghana_physics.nc"
    bgc_path = "./raw_data/ghana_bgc.nc"
    db_file = "data.json"
    
    if not (os.path.exists(physics_path) and os.path.exists(bgc_path)):
        print("Data files missing.")
        return

    ds_phy = xr.open_dataset(physics_path)
    ds_bgc = xr.open_dataset(bgc_path)
    
    tau_x = ds_phy['tauuo'] 
    mld = ds_phy['mlotst']
    no3 = ds_bgc['no3']

    # CUTI calculation based on wind stress & Coriolis at 5°N
    cuti = tau_x / (RHO_WATER * F_CORIOLIS)
    
    # BEUTI calculation: Interpolate nitrate at the base of the Mixed Layer Depth
    no3_at_mld = no3.interp(depth=mld, method="linear")
    beuti = cuti * no3_at_mld

    # Spatial average for Ghana's immediate coastal strip
    cuti_coastal = cuti.sel(latitude=slice(4.8, 5.2)).mean(dim=['latitude', 'longitude'])
    beuti_coastal = beuti.sel(latitude=slice(4.8, 5.2)).mean(dim=['latitude', 'longitude'])
    
    time_steps = cuti_coastal.time.values
    new_records = []
    
    for i, t in enumerate(time_steps):
        date_str = str(t)[:10] 
        val_cuti = float(cuti_coastal.values[i])
        val_beuti = float(beuti_coastal.values[i])
        
        if np.isnan(val_cuti): val_cuti = 0.0
        if np.isnan(val_beuti): val_beuti = 0.0

        new_records.append({
            "date": date_str,
            "cuti": round(val_cuti, 4),
            "beuti": round(val_beuti, 4)
        })
        
    ds_phy.close()
    ds_bgc.close()
    
    # Read existing database or create new one
    existing_data = []
    if os.path.exists(db_file):
        with open(db_file, "r") as f:
            try:
                existing_data = json.load(f)
            except:
                existing_data = []

    # Merge records securely ensuring unique dates
    existing_dict = {item["date"]: item for item in existing_data}
    for rec in new_records:
        existing_dict[rec["date"]] = rec
        
    sorted_data = [existing_dict[d] for d in sorted(existing_dict.keys())]
    
    with open(db_file, "w") as f:
        json.dump(sorted_data, f, indent=2)
        
    print(f"Database compiled. Total entries: {len(sorted_data)}")

if __name__ == "__main__":
    calculate_indices()
