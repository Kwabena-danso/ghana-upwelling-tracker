import os
import datetime
import copernicusmarine

def download_ghana_data():
    # Fetch data for the last 7 days to cover the weekly step
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=7)
    
    print(f"Downloading data from {start_date} to {end_date} for Ghana EEZ...")
    
    cms_username = os.getenv("CMS_USERNAME")
    cms_password = os.getenv("CMS_PASSWORD")
    
    # 1. Download Physics Data (Wind Stress 'tauuo' & Mixed Layer Depth 'mlotst')
    try:
        copernicusmarine.subset(
            dataset_id="GLOBAL_ANALYSISFORECAST_PHY_001_024",
            variables=["mlotst", "tauuo"],
            minimum_longitude=-3.5,
            maximum_longitude=1.5,
            minimum_latitude=2.0,
            maximum_latitude=6.2,
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
            output_directory="./raw_data",
            output_filename="ghana_physics.nc",
            username=cms_username,
            password=cms_password,
            force_download=True
        )
        print("Physics data downloaded.")
    except Exception as e:
        print(f"Error downloading physics data: {e}")

    # 2. Download Biogeochemical Data (Nitrate concentration 'no3')
    try:
        copernicusmarine.subset(
            dataset_id="GLOBAL_ANALYSISFORECAST_BGC_001_028",
            variables=["no3"],
            minimum_longitude=-3.5,
            maximum_longitude=1.5,
            minimum_latitude=2.0,
            maximum_latitude=6.2,
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
            output_directory="./raw_data",
            output_filename="ghana_bgc.nc",
            username=cms_username,
            password=cms_password,
            force_download=True
        )
        print("Biogeochemical data downloaded.")
    except Exception as e:
        print(f"Error downloading BGC data: {e}")

if __name__ == "__main__":
    os.makedirs("./raw_data", exist_ok=True)
    download_ghana_data()
